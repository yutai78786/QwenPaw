# -*- coding: utf-8 -*-
"""Integration tests for ``qwenpaw acp`` driven end-to-end over stdio.

The ACP server (``agents/acp/server.py``, 671 statements) is the agent
that speaks JSON-RPC over stdin/stdout to an editor. Every line of it was
dead to the integration metric: the former ``test_acp_server_module.py``
imported ``_extract_text`` / ``_EnvelopeTracker`` and called their static
methods inside the pytest process, which is unit coverage wearing an
integration label. These helpers are already covered by
``tests/unit/agents/test_acp_tool_capture.py`` and
``tests/unit/agents/test_acp_available_commands.py`` (which between them
bring ``server.py`` to 60% in-process).

This file instead launches the real command as a subprocess and talks
the protocol to it, so the dispatch, validation and session bookkeeping
actually run inside the traced child:

* ``initialize`` advertises capabilities / agentInfo / protocolVersion
* ``session/new`` creates a session, advertises commands, lists models
* ``session/list`` reflects it, ``session/close`` drops it (and is
  idempotent for an unknown id)
* ``session/load`` and ``session/set_mode`` succeed on a live session
* protocol errors: unknown method -> -32601, missing required field ->
  -32602 carrying the pydantic ``errors`` array
* ``session/prompt`` with no model configured streams a
  ``session/update`` notification then fails -32603
* ``session/set_model`` rejects an unknown model id by name
* CLI-level guards: ``--runtime-provider openai-env`` without the
  ``OPENAI_*`` trio exits 2 with the missing-variable message;
  ``--debug`` raises the log level (default emits no DEBUG line)

Two helpers the old file called are deliberately absent: ``_extract_text``
and the ``_EnvelopeTracker`` static methods are pure functions with no
protocol entry point — a request that exercised them would need a real
model answering with tool calls. They stay in the unit layer.

Shutdown: each case closes the child's **stdin**. The stdio loop sees
EOF and the process exits on its own (measured 0.5 s, rc 0), so atexit
runs and subprocess coverage flushes. That needs no signal handling at
all, unlike the app-server fixture, which has to map SIGINT on POSIX to
CTRL_BREAK_EVENT plus a SIGBREAK wrapper on Windows to avoid losing
coverage data.
"""

from __future__ import annotations

import json
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

import pytest
from helpers import coverage_subprocess_env

# ACP starts a workspace (plugin bootstrap, chat manager, memory
# manager), so give requests room without hiding a real deadlock.
_REQUEST_TIMEOUT = 90.0
_SHUTDOWN_TIMEOUT = 45.0

_ROOT = Path(__file__).resolve().parents[2]

# Minimal client capabilities; the agent does not require either fs
# method for the calls made here.
_CLIENT_CAPS = {
    "fs": {"readTextFile": False, "writeTextFile": False},
}


def _env(working_dir: Path, home: Path) -> dict[str, str]:
    """Environment pinning an ACP child to throwaway directories.

    Starts from :func:`coverage_subprocess_env` so the child is traced
    when ``QWENPAW_INTEGRATION_COVERAGE`` is set, then redirects the
    working/secret dirs away from anything real.
    """
    env = coverage_subprocess_env()
    env.update(
        {
            "QWENPAW_WORKING_DIR": str(working_dir),
            "QWENPAW_SECRET_DIR": str(home / "secret"),
            "HOME": str(home),
            "USERPROFILE": str(home),
            "QWENPAW_AUTH_ENABLED": "false",
            "QWENPAW_RUNNING_IN_CONTAINER": "true",
            "PYTHONIOENCODING": "utf-8",
            "NO_PROXY": "*",
        },
    )
    # Strip any ambient model configuration so the "no active model"
    # paths below are deterministic instead of depending on the machine.
    for name in ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"):
        env.pop(name, None)
    return env


class AcpClient:
    """A JSON-RPC client talking to a real ``qwenpaw acp`` subprocess."""

    def __init__(self, working_dir: Path, home: Path, *extra_args: str):
        self.working_dir = working_dir
        self._next_id = 0
        self.notifications: list[dict[str, Any]] = []
        self._inbox: queue.Queue[str] = queue.Queue()
        self._errbox: queue.Queue[str] = queue.Queue()
        self._proc = subprocess.Popen(  # pylint: disable=consider-using-with
            [sys.executable, "-m", "qwenpaw", "acp", *extra_args],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            # Decode as UTF-8 in the parent: without this Popen falls
            # back to cp1252 on Windows CI runners.
            encoding="utf-8",
            errors="replace",
            env=_env(working_dir, home),
            cwd=str(_ROOT),
        )
        assert self._proc.stdin is not None
        assert self._proc.stdout is not None
        assert self._proc.stderr is not None
        self._stdout_thread = threading.Thread(
            target=self._pump,
            args=(self._proc.stdout, self._inbox),
            daemon=True,
        )
        self._stderr_thread = threading.Thread(
            target=self._pump,
            args=(self._proc.stderr, self._errbox),
            daemon=True,
        )
        self._stdout_thread.start()
        self._stderr_thread.start()

    @staticmethod
    def _pump(stream, sink: queue.Queue) -> None:
        """Drain a stream so the child never blocks on a full pipe."""
        for line in stream:
            if line.strip():
                sink.put(line.strip())

    def request(
        self,
        method: str,
        params: dict[str, Any] | None = None,
        timeout: float = _REQUEST_TIMEOUT,
    ) -> dict[str, Any]:
        """Send one request and wait for the response with a matching id."""
        self._next_id += 1
        rid = self._next_id
        self._send(
            {
                "jsonrpc": "2.0",
                "id": rid,
                "method": method,
                "params": params if params is not None else {},
            },
        )
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = self._next_message(deadline - time.time())
            if message is None:
                break
            # Server-pushed notifications carry no id; keep them so a
            # case can assert on what arrived before the response.
            if "id" not in message:
                self.notifications.append(message)
                continue
            if message.get("id") == rid:
                return message
        raise AssertionError(
            f"no response to {method!r} (id={rid}) within {timeout}s; "
            f"notifications={[n.get('method') for n in self.notifications]}",
        )

    def _send(self, payload: dict[str, Any]) -> None:
        assert self._proc.stdin is not None
        self._proc.stdin.write(json.dumps(payload) + "\n")
        self._proc.stdin.flush()

    def _next_message(self, wait: float) -> dict[str, Any] | None:
        assert self._proc.stdout is not None
        try:
            line = self._inbox.get(timeout=max(wait, 0.1))
        except queue.Empty:
            return None
        return json.loads(line)

    def initialize(self) -> dict[str, Any]:
        """Perform the mandatory handshake; returns the result payload."""
        return self.request(
            "initialize",
            {"protocolVersion": 1, "clientCapabilities": _CLIENT_CAPS},
        )["result"]

    def wait_for_update(
        self,
        key: str,
        timeout: float = _REQUEST_TIMEOUT,
    ) -> dict[str, Any]:
        """Wait for a ``session/update`` notification carrying ``key``.

        Server pushes are emitted from a background task
        (``asyncio.create_task(self._advertise_commands(...))``), so they
        can legitimately arrive after the response to ``session/new``.
        Polling for the expected key keeps the case deterministic instead
        of racing the child.
        """
        deadline = time.time() + timeout
        while time.time() < deadline:
            message = self._next_message(deadline - time.time())
            if message is None:
                continue
            if "id" not in message:
                self.notifications.append(message)
                update = (message.get("params") or {}).get("update") or {}
                if key in update:
                    return update
        seen = [
            sorted(((n.get("params") or {}).get("update") or {}).keys())
            for n in self.notifications
        ]
        raise AssertionError(
            f"no session/update carrying {key!r} within {timeout}s; "
            f"notification updates seen: {seen}",
        )

    def new_session(self) -> dict[str, Any]:
        """Open a session in the throwaway working dir."""
        return self.request(
            "session/new",
            {"cwd": str(self.working_dir), "mcpServers": []},
        )["result"]

    @property
    def stderr(self) -> str:
        """Everything the child logged on stderr so far."""
        lines: list[str] = []
        while True:
            try:
                lines.append(self._errbox.get_nowait())
            except queue.Empty:
                return "\n".join(lines)

    def shutdown(self) -> int:
        """Close stdin and let the stdio loop exit on its own."""
        assert self._proc.stdin is not None
        self._proc.stdin.close()
        try:
            return self._proc.wait(timeout=_SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait(timeout=15)
            raise AssertionError(
                "ACP child did not exit after stdin EOF; the stdio loop "
                "is not treating EOF as shutdown",
            ) from None


@pytest.fixture(name="acp")
def _acp(tmp_path: Path):
    """A fresh ACP subprocess per case, always shut down by stdin EOF."""
    working_dir = tmp_path / "working"
    working_dir.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    client = AcpClient(working_dir, home)
    try:
        yield client
    finally:
        if client._proc.poll() is None:  # pylint: disable=protected-access
            client.shutdown()


@pytest.fixture(name="handshaked")
def _handshaked(acp: AcpClient) -> AcpClient:
    """An ACP client that has completed ``initialize``."""
    acp.initialize()
    return acp


@pytest.mark.integration
@pytest.mark.p1
def test_initialize_advertises_capabilities(acp: AcpClient) -> None:
    """The handshake reports protocol version, identity and capabilities."""
    result = acp.initialize()

    assert result["protocolVersion"] == 1
    assert result["agentInfo"]["name"] == "qwenpaw"
    assert result["agentInfo"]["title"] == "QwenPaw"
    assert result["agentInfo"]["version"]
    caps = result["agentCapabilities"]
    assert caps["loadSession"] is True
    assert caps["mcpCapabilities"] == {"http": True, "sse": True}
    assert sorted(caps["sessionCapabilities"]) == ["close", "list", "resume"]


@pytest.mark.integration
@pytest.mark.p1
def test_shutdown_is_clean_on_stdin_eof(acp: AcpClient) -> None:
    """Closing stdin ends the agent with rc 0, so coverage flushes."""
    acp.initialize()

    assert acp.shutdown() == 0


@pytest.mark.integration
@pytest.mark.p1
def test_new_session_returns_id_and_session_state(
    handshaked: AcpClient,
) -> None:
    """A new session gets an id, its modes and the available models."""
    result = handshaked.new_session()

    assert len(result["sessionId"]) == 32
    assert result["_meta"]["qwenpaw.agent"] == "default"
    # The mode picker is advertised so an editor can offer it.
    modes = [o for o in result["configOptions"] if o["id"] == "mode"]
    assert len(modes) == 1
    assert modes[0]["currentValue"] == "default"
    values = {o["value"] for o in modes[0]["options"]}
    assert values == {"default", "bypassPermissions"}
    assert result["models"]["availableModels"]


@pytest.mark.integration
@pytest.mark.p1
def test_new_session_advertises_slash_commands(handshaked: AcpClient) -> None:
    """Creating a session pushes the command palette as a notification."""
    handshaked.new_session()

    # Pushed from a background task, so wait rather than race the child.
    update = handshaked.wait_for_update("availableCommands")
    names = {c["name"] for c in update["availableCommands"]}
    assert {"model", "skills", "clear", "compact"} <= names
    assert all(c["description"] for c in update["availableCommands"])


@pytest.mark.integration
@pytest.mark.p1
def test_list_sessions_shows_created_session(handshaked: AcpClient) -> None:
    """The session just created is listed with its cwd and a title."""
    created = handshaked.new_session()

    listed = handshaked.request("session/list")["result"]["sessions"]

    assert len(listed) == 1
    assert listed[0]["sessionId"] == created["sessionId"]
    assert listed[0]["cwd"] == str(handshaked.working_dir)
    assert listed[0]["title"].startswith("ACP session ")


@pytest.mark.integration
@pytest.mark.p1
def test_list_sessions_empty_before_any_is_created(acp: AcpClient) -> None:
    """A fresh agent with no session lists none (no cross-case leakage)."""
    acp.initialize()

    assert acp.request("session/list")["result"]["sessions"] == []


@pytest.mark.integration
@pytest.mark.p1
def test_close_session_removes_it_from_listing(
    handshaked: AcpClient,
) -> None:
    """Closing the only session empties the list again."""
    created = handshaked.new_session()

    assert (
        handshaked.request(
            "session/close",
            {"sessionId": created["sessionId"]},
        )["result"]
        == {}
    )
    assert handshaked.request("session/list")["result"]["sessions"] == []


@pytest.mark.integration
@pytest.mark.p1
def test_close_session_is_idempotent_for_unknown_id(
    handshaked: AcpClient,
) -> None:
    """Closing a session that never existed is a no-op, not an error."""
    handshaked.initialize()

    result = handshaked.request(
        "session/close",
        {"sessionId": "deadbeefdeadbeefdeadbeefdeadbeef"},
    )

    assert result["result"] == {}


@pytest.mark.integration
@pytest.mark.p1
def test_load_session_reports_agent_meta(handshaked: AcpClient) -> None:
    """Loading an existing session reports which agent owns it."""
    created = handshaked.new_session()

    result = handshaked.request(
        "session/load",
        {
            "sessionId": created["sessionId"],
            "cwd": str(handshaked.working_dir),
            "mcpServers": [],
        },
    )

    assert result["result"]["_meta"]["qwenpaw.agent"] == "default"


@pytest.mark.integration
@pytest.mark.p1
def test_set_mode_to_bypass_permissions_is_accepted(
    handshaked: AcpClient,
) -> None:
    """The advertised ``bypassPermissions`` mode can actually be set."""
    created = handshaked.new_session()

    result = handshaked.request(
        "session/set_mode",
        {"sessionId": created["sessionId"], "modeId": "bypassPermissions"},
    )

    assert result["result"] == {}


@pytest.mark.integration
@pytest.mark.p1
def test_unknown_method_is_rejected_with_method_not_found(
    handshaked: AcpClient,
) -> None:
    """An unimplemented method yields JSON-RPC -32601 naming it."""
    response = handshaked.request("totally/unknown")

    assert response["error"]["code"] == -32601
    assert response["error"]["message"] == "Method not found"
    assert response["error"]["data"]["method"] == "totally/unknown"


@pytest.mark.integration
@pytest.mark.p1
def test_missing_required_field_reports_invalid_params(
    handshaked: AcpClient,
) -> None:
    """Omitting ``sessionId`` yields -32602 with the pydantic detail."""
    response = handshaked.request("session/close")

    error = response["error"]
    assert error["code"] == -32602
    assert error["message"] == "Invalid params"
    problems = error["data"]["errors"]
    assert problems[0]["type"] == "missing"
    assert problems[0]["loc"] == ["sessionId"]
    assert problems[0]["msg"] == "Field required"


@pytest.mark.integration
@pytest.mark.p1
def test_set_model_rejects_unknown_model_by_name(
    handshaked: AcpClient,
) -> None:
    """An id absent from every provider is rejected naming the model."""
    created = handshaked.new_session()

    response = handshaked.request(
        "session/set_model",
        {"sessionId": created["sessionId"], "modelId": "no-such-model"},
    )

    error = response["error"]
    assert error["code"] == -32602
    assert error["data"]["model_id"] == "no-such-model"
    assert "not found in any provider" in error["data"]["details"]


@pytest.mark.integration
@pytest.mark.p1
def test_prompt_without_model_streams_update_then_fails(
    handshaked: AcpClient,
) -> None:
    """With no model configured a prompt fails -32603 after notifying."""
    created = handshaked.new_session()
    handshaked.notifications.clear()

    response = handshaked.request(
        "session/prompt",
        {
            "sessionId": created["sessionId"],
            "prompt": [{"type": "text", "text": "say hi"}],
        },
    )

    assert response["error"]["code"] == -32603
    assert response["error"]["message"] == "Internal error"
    assert response["error"]["data"]["details"] == "QwenPaw runtime failed"
    # The failure is reported to the user as streamed content first, so
    # an editor shows *something* rather than a bare RPC error.
    kinds = {
        (n.get("params") or {}).get("update", {}).get("sessionUpdate")
        for n in handshaked.notifications
    }
    assert "agent_message_chunk" in kinds or len(kinds) > 1


def _run_acp_cli(
    working_dir: Path,
    home: Path,
    *args: str,
) -> subprocess.CompletedProcess:
    """Run ``qwenpaw acp <args>`` with stdin reaching EOF right away.

    ``input=""`` gives the child a pipe that is written empty and closed,
    which the stdio loop treats as shutdown (measured 2.3 s, rc 0).
    ``stdin=DEVNULL`` does *not*: the agent keeps running past 50 s, so
    every case here would time out. A run that rejects its arguments
    (``--runtime-provider`` without the env trio) never enters the loop
    and exits 2 either way.
    """
    return subprocess.run(
        [sys.executable, "-m", "qwenpaw", "acp", *args],
        input="",
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=_SHUTDOWN_TIMEOUT,
        check=False,
        cwd=str(_ROOT),
        env=_env(working_dir, home),
    )


@pytest.fixture(name="cli_dirs")
def _cli_dirs(tmp_path: Path) -> tuple[Path, Path]:
    working_dir = tmp_path / "working"
    working_dir.mkdir()
    home = tmp_path / "home"
    home.mkdir()
    return working_dir, home


@pytest.mark.integration
@pytest.mark.p1
def test_runtime_provider_flag_requires_openai_env(
    cli_dirs: tuple[Path, Path],
) -> None:
    """``--runtime-provider openai-env`` exits 2 naming the missing vars."""
    working_dir, home = cli_dirs

    proc = _run_acp_cli(working_dir, home, "--runtime-provider", "openai-env")

    assert proc.returncode == 2
    assert "Missing runtime provider environment:" in proc.stderr
    for name in ("OPENAI_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL"):
        assert name in proc.stderr
    # It refuses before speaking any protocol.
    assert proc.stdout == ""


@pytest.mark.integration
@pytest.mark.p1
def test_debug_flag_raises_log_level(cli_dirs: tuple[Path, Path]) -> None:
    """``--debug`` emits DEBUG records that the default run does not."""
    working_dir, home = cli_dirs

    plain = _run_acp_cli(working_dir, home)
    debugged = _run_acp_cli(working_dir, home, "--debug")

    assert not any(
        line.startswith("DEBUG") for line in plain.stderr.splitlines()
    )
    assert any(
        line.startswith("DEBUG") for line in debugged.stderr.splitlines()
    )
    assert debugged.returncode == 0


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_is_created_under_working_dir(acp: AcpClient) -> None:
    """Opening a session materialises the agent workspace on disk."""
    acp.initialize()
    acp.new_session()

    workspace = acp.working_dir / "workspaces" / "default"
    assert workspace.is_dir()
    # The agent profile is written during workspace startup, and is the
    # only entry present at this point (measured on 3 consecutive runs:
    # ``['agent.json']``). The memory/digest/media subdirectories are
    # created by background startup tasks ~2 s later, so asserting them
    # here would be flaky; same for ``chats.json``, whose path is printed
    # in the startup log but which only appears once a chat is persisted.
    assert (workspace / "agent.json").exists()
    profile = json.loads(
        (workspace / "agent.json").read_text(encoding="utf-8"),
    )
    # The profile keys its own id "id", not "agent_id" (verified against a
    # real run: {"id": "default", "name": "Default", "backend": "qwenpaw"}).
    assert profile["id"] == "default"
    assert profile["workspace_dir"] == str(workspace)
