# -*- coding: utf-8 -*-
"""Integration tests driving the CLI as a real subprocess.

Every case shells out to ``python -m qwenpaw`` pinned to the module's
app-server subprocess via the global ``--host``/``--port`` options, so
one run exercises both the CLI command layer and the HTTP API behind
it, and the CLI's view is cross-checked against a direct API call.

Why this file exists: the pre-existing CLI cases either call internal
functions directly (no subprocess, therefore invisible to the
integration coverage report) or shell out without
``COVERAGE_PROCESS_START``, which leaves the whole ``cli/`` package at
0% however many cases pass. ``helpers.run_cli`` injects the same rcfile
and data-file basename that ``conftest.py`` gives the app subprocess,
so ``coverage combine`` picks these traces up too.

Targets reached: cli/agents_cmd.py, cli/cron_cmd.py, cli/chats_cmd.py,
cli/skills_cmd.py, cli/channels_cmd.py, cli/models_cmd.py,
cli/doctor_cmd.py, cli/doctor_checks.py, cli/main.py.

Isolation rules, all enforced by ``_cli``/``_cli_env``:

* ``QWENPAW_WORKING_DIR`` points at this test's app server, never the
  developer's ``~/.qwenpaw``; ``HOME``/``USERPROFILE`` are redirected
  to a throwaway directory.
* Host and port always come from the fixture, so the CLI default port
  8088 (a shared team service on our runners) is never touched.
* Destructive commands run read-only (``clean --dry-run``,
  ``doctor fix --dry-run``); ``update`` and ``uninstall`` are never
  invoked because they would mutate the runner environment.
"""

from __future__ import annotations

import hashlib
import json
import socket
from pathlib import Path

import pytest
from helpers import default_http_timeout, run_cli

_HTTP_T = default_http_timeout(30.0)
_CLI_TIMEOUT = 180.0


def _cli_env(app_server, home: Path) -> dict[str, str]:
    """Environment keeping a CLI run inside this test's sandbox."""
    return {
        "QWENPAW_WORKING_DIR": str(app_server.working_dir),
        "QWENPAW_SECRET_DIR": str(home / "secret"),
        "QWENPAW_AUTH_ENABLED": "false",
        "QWENPAW_RUNNING_IN_CONTAINER": "true",
        "PYTHONIOENCODING": "utf-8",
        "NO_PROXY": "*",
    }


def _cli(
    app_server,
    home: Path,
    *args: str,
    timeout: float = _CLI_TIMEOUT,
):
    """Run ``qwenpaw <args>`` against this test's app server."""
    return run_cli(
        "--host",
        app_server.host,
        "--port",
        str(app_server.port),
        *args,
        timeout=timeout,
        home=home,
        extra_env=_cli_env(app_server, home),
    )


def _stderr_lines(result) -> list[str]:
    """Stderr without the framework's INFO log noise."""
    return [
        line
        for line in result.stderr.splitlines()
        if line.strip() and not line.startswith("INFO")
    ]


def _free_port() -> int:
    """A port nothing is listening on (kernel-assigned, then closed)."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


# ------------------------------------------------------------------ #
# agents
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_agents_list_matches_api(app_server, tmp_path) -> None:
    """``agents list`` reports the same ids as the HTTP API."""
    result = _cli(app_server, tmp_path, "agents", "list")
    assert result.returncode == 0, result.stderr

    payload = json.loads(result.stdout)
    cli_ids = sorted(agent["id"] for agent in payload["agents"])
    assert "default" in cli_ids, payload

    api = app_server.api_request("GET", "/api/agents", timeout=_HTTP_T)
    assert api.status_code == 200, app_server.logs_tail()
    api_ids = sorted(agent["id"] for agent in api.json()["agents"])
    assert cli_ids == api_ids, (cli_ids, api_ids)


@pytest.mark.integration
@pytest.mark.p1
def test_agents_list_reports_agent_fields(app_server, tmp_path) -> None:
    """Each listed agent carries the fields the console relies on."""
    result = _cli(app_server, tmp_path, "agents", "list")
    assert result.returncode == 0, result.stderr

    agents = {a["id"]: a for a in json.loads(result.stdout)["agents"]}
    default = agents["default"]
    for field in (
        "name",
        "enabled",
        "workspace_dir",
        "startup_status",
        "backend",
    ):
        assert field in default, default
    assert default["enabled"] is True, default
    assert Path(default["workspace_dir"]).is_dir(), default


@pytest.mark.integration
@pytest.mark.p1
def test_agent_alias_reports_same_agents(app_server, tmp_path) -> None:
    """``agent`` is an alias of ``agents`` and returns the same set."""
    plural = _cli(app_server, tmp_path, "agents", "list")
    singular = _cli(app_server, tmp_path, "agent", "list")
    assert plural.returncode == 0, plural.stderr
    assert singular.returncode == 0, singular.stderr

    first = json.loads(plural.stdout)["agents"]
    second = json.loads(singular.stdout)["agents"]
    first_ids = sorted(a["id"] for a in first)
    second_ids = sorted(a["id"] for a in second)
    assert first_ids == second_ids, (first_ids, second_ids)


# ------------------------------------------------------------------ #
# chats and cron: CLI reflects state created through the API
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_chats_list_reflects_created_chat(app_server, tmp_path) -> None:
    """A chat created through the API shows up in ``chats list``."""
    before = _cli(app_server, tmp_path, "chats", "list")
    assert before.returncode == 0, before.stderr
    created_ids = {c["id"] for c in json.loads(before.stdout)}

    chat_base = "/api/agents/default/chats"
    created = app_server.api_request(
        "POST",
        chat_base,
        json={
            "name": "CLI chat probe",
            "session_id": "console:integ-cli-chat-01",
            "user_id": "integ-cli-chat-user",
            "channel": "console",
            "meta": {},
        },
        timeout=_HTTP_T,
    )
    assert created.status_code == 200, app_server.logs_tail()
    chat_id = created.json()["id"]
    assert isinstance(chat_id, str) and chat_id, created.json()

    try:
        after = _cli(app_server, tmp_path, "chats", "list")
        assert after.returncode == 0, after.stderr
        listed = {c["id"] for c in json.loads(after.stdout)}
        assert chat_id in listed - created_ids, (created_ids, listed)
    finally:
        app_server.api_request(
            "DELETE",
            f"{chat_base}/{chat_id}",
            timeout=_HTTP_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_cron_list_reflects_created_job(app_server, tmp_path) -> None:
    """A cron job created through the API shows up in ``cron list``."""
    before = _cli(app_server, tmp_path, "cron", "list")
    assert before.returncode == 0, before.stderr

    job = {
        "name": "integ-cli-cron-01",
        "enabled": False,
        "schedule": {
            "type": "cron",
            "cron": "0 0 1 1 *",
            "timezone": "UTC",
        },
        "task_type": "agent",
        "request": {"input": {"type": "text", "text": "CLI cron probe"}},
        "dispatch": {
            "type": "channel",
            "channel": "console",
            "target": {
                "user_id": "cron-cli-probe-user",
                "session_id": "console:cron-cli-probe-sess",
            },
            "mode": "stream",
        },
    }
    created = app_server.api_request(
        "POST",
        "/api/cron/jobs",
        json=job,
        timeout=_HTTP_T,
    )
    assert created.status_code == 200, app_server.logs_tail()
    job_id = created.json().get("id")
    assert job_id, created.json()

    try:
        after = _cli(app_server, tmp_path, "cron", "list")
        assert after.returncode == 0, after.stderr
        listed = {j["id"] for j in json.loads(after.stdout)}
        assert job_id in listed, (job_id, listed)

        fetched = _cli(app_server, tmp_path, "cron", "get", job_id)
        assert fetched.returncode == 0, fetched.stderr
        # ``cron get`` wraps the job in {"spec": {...}}, unlike the flat
        # list emitted by ``cron list``.
        spec = json.loads(fetched.stdout)["spec"]
        assert spec["id"] == job_id, spec
        assert spec["name"] == job["name"], spec
        assert spec["enabled"] is False, spec
    finally:
        app_server.api_request(
            "DELETE",
            f"/api/cron/jobs/{job_id}",
            timeout=_HTTP_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_cron_get_unknown_id_fails(app_server, tmp_path) -> None:
    """Asking for a job that never existed is an error, not empty."""
    result = _cli(
        app_server,
        tmp_path,
        "cron",
        "get",
        "integ-cli-cron-absent",
    )
    assert result.returncode != 0, result.stdout
    assert result.stdout.strip() in ("", "[]", "null")


# ------------------------------------------------------------------ #
# daemon / skills / plugins / env / models / channels
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_daemon_status_reports_working_dir(app_server, tmp_path) -> None:
    """``daemon status`` describes the agent this server runs."""
    result = _cli(app_server, tmp_path, "daemon", "status")
    assert result.returncode == 0, result.stderr
    assert "Daemon Status" in result.stdout, result.stdout
    assert "Agent: default" in result.stdout, result.stdout
    assert str(app_server.working_dir) in result.stdout, result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_skills_list_is_scoped_to_agent(app_server, tmp_path) -> None:
    """``skills list`` names the agent whose workspace it scanned."""
    result = _cli(app_server, tmp_path, "skills", "list")
    assert result.returncode == 0, result.stderr
    assert "Skills for agent: default" in result.stdout, result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_plugin_list_empty_workspace(app_server, tmp_path) -> None:
    """A fresh workspace reports no installed plugins."""
    result = _cli(app_server, tmp_path, "plugin", "list")
    assert result.returncode == 0, result.stderr
    assert "No plugins installed" in result.stdout, result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_env_list_empty_workspace(app_server, tmp_path) -> None:
    """A fresh workspace reports no configured variables."""
    result = _cli(app_server, tmp_path, "env", "list")
    assert result.returncode == 0, result.stderr
    assert "No environment variables configured" in result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_models_local_empty_workspace(app_server, tmp_path) -> None:
    """No local model repository has been downloaded yet."""
    result = _cli(app_server, tmp_path, "models", "local")
    assert result.returncode == 0, result.stderr
    assert "No local models downloaded" in result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_models_list_reports_providers(app_server, tmp_path) -> None:
    """``models list`` renders the built-in provider catalogue."""
    result = _cli(app_server, tmp_path, "models", "list")
    assert result.returncode == 0, result.stderr
    assert len(result.stdout) > 500, result.stdout[:200]

    api = app_server.api_request("GET", "/api/models", timeout=_HTTP_T)
    assert api.status_code == 200, app_server.logs_tail()
    providers = api.json()
    assert isinstance(providers, list) and providers, providers
    provider = providers[0]["id"]
    assert provider in result.stdout, (provider, result.stdout[:400])


@pytest.mark.integration
@pytest.mark.p1
def test_channels_list_reports_channel_names(app_server, tmp_path) -> None:
    """``channels list`` renders the known channel types."""
    result = _cli(app_server, tmp_path, "channels", "list")
    assert result.returncode == 0, result.stderr
    assert len(result.stdout) > 500, result.stdout[:200]
    assert "console" in result.stdout.lower(), result.stdout[:400]


# ------------------------------------------------------------------ #
# doctor
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_doctor_reports_environment_sections(app_server, tmp_path) -> None:
    """``doctor`` prints its report section by section."""
    result = _cli(app_server, tmp_path, "doctor")
    for section in (
        "=== Environment ===",
        "=== Config ===",
        "=== Agents ===",
        "=== API ===",
    ):
        assert section in result.stdout, result.stdout[:600]
    assert "qwenpaw version" in result.stdout, result.stdout[:400]


@pytest.mark.integration
@pytest.mark.p1
def test_doctor_reaches_this_app_server(app_server, tmp_path) -> None:
    """Health probing targets the pinned port, not the CLI default."""
    result = _cli(app_server, tmp_path, "doctor")
    expected = f"{app_server.host}:{app_server.port}/api/healthz"
    assert expected in result.stdout, result.stdout[-900:]
    assert "OK — health" in result.stdout, result.stdout[-900:]
    # The shared team service on the default port must not be probed.
    assert "8088" not in result.stdout, result.stdout[-900:]


@pytest.mark.integration
@pytest.mark.p1
def test_doctor_fails_without_active_llm(app_server, tmp_path) -> None:
    """No configured model is reported as a failure on stderr."""
    result = _cli(app_server, tmp_path, "doctor")
    assert result.returncode == 1, (result.returncode, result.stdout)
    stderr = "\n".join(_stderr_lines(result))
    assert "FAIL" in stderr, stderr
    assert "no active LLM slot" in stderr, stderr


# ------------------------------------------------------------------ #
# read-only destructive commands
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_clean_dry_run_keeps_files(app_server, tmp_path) -> None:
    """``clean --dry-run`` lists candidates but deletes nothing."""
    probe = app_server.working_dir / "integ-cli-clean-probe.md"
    probe.write_text("keep me", encoding="utf-8")
    try:
        result = _cli(app_server, tmp_path, "clean", "--dry-run", "--yes")
        assert result.returncode == 0, result.stderr
        assert probe.exists(), "dry run deleted a file"
        assert probe.read_text(encoding="utf-8") == "keep me"
    finally:
        probe.unlink(missing_ok=True)


@pytest.mark.integration
@pytest.mark.p1
def test_doctor_fix_dry_run_modifies_nothing(app_server, tmp_path) -> None:
    """``doctor fix --dry-run`` leaves the config byte-identical."""
    config = app_server.working_dir / "config.json"
    assert config.exists(), list(app_server.working_dir.iterdir())
    digest = hashlib.sha256(config.read_bytes()).hexdigest()
    mtime = config.stat().st_mtime

    result = _cli(app_server, tmp_path, "doctor", "fix", "--dry-run")
    assert result.returncode == 0, result.stderr
    assert hashlib.sha256(config.read_bytes()).hexdigest() == digest
    assert config.stat().st_mtime == mtime


# ------------------------------------------------------------------ #
# CLI argument handling
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_cli_rejects_unknown_command(app_server, tmp_path) -> None:
    """An unknown subcommand exits with click's usage error."""
    result = _cli(app_server, tmp_path, "definitely-not-a-command")
    assert result.returncode == 2, result.returncode
    stderr = "\n".join(_stderr_lines(result))
    assert "No such command" in stderr, stderr
    assert "Usage:" in stderr, stderr


@pytest.mark.integration
@pytest.mark.p1
def test_cli_version_matches_package(app_server, tmp_path) -> None:
    """``--version`` prints the source-tree version.

    Reads ``qwenpaw.__version__`` rather than distribution metadata: an
    editable checkout reports the installed release version (whatever
    was last built), while the CLI prints the tree's own constant.
    """
    from qwenpaw.__version__ import __version__

    result = _cli(app_server, tmp_path, "--version")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == f"QwenPaw, version {__version__}"


@pytest.mark.integration
@pytest.mark.p1
def test_cli_reports_unreachable_server(tmp_path) -> None:
    """Pointing at a dead port fails instead of hanging or lying."""
    port = _free_port()
    result = run_cli(
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "cron",
        "list",
        timeout=_CLI_TIMEOUT,
        home=tmp_path,
        extra_env={
            "QWENPAW_WORKING_DIR": str(tmp_path / "working"),
            "QWENPAW_SECRET_DIR": str(tmp_path / "secret"),
            "QWENPAW_AUTH_ENABLED": "false",
            "QWENPAW_RUNNING_IN_CONTAINER": "true",
            "PYTHONIOENCODING": "utf-8",
            "NO_PROXY": "*",
        },
    )
    assert result.returncode != 0, result.stdout
    combined = result.stdout + "\n".join(_stderr_lines(result))
    assert str(port) in combined or "onnect" in combined, combined[:400]
