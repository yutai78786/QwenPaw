# -*- coding: utf-8 -*-
"""Integration tests driving builtin tool execution through the runtime.

High-leverage coverage: each case forces the mock LLM to emit a tool
call for a builtin tool (read_file, list_directory, get_current_time,
execute_shell_command), so the real tool implementation plus the
agent tool-execution path run inside the app subprocess.

Targets reached: src/qwenpaw/agents/tools/* (shell, file tools), the
tool-call loop in the runtime, and tool result formatting.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import HTTPServer

import pytest

from helpers import (
    MOCK_LLM_PROVIDER_ID,
    MockLLMHandler,
    default_http_timeout,
    register_mock_provider,
    unregister_mock_provider,
)

_HTTP_TIMEOUT = default_http_timeout(60.0)


@pytest.fixture(scope="module")
def mock_llm():
    """Module-scoped mock OpenAI server with tool_call support."""
    srv = HTTPServer(("127.0.0.1", 0), MockLLMHandler)
    srv.force_error = False
    srv.force_tool_call = False
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, f"http://127.0.0.1:{port}/v1"
    srv.shutdown()


def _chat_with_tool(app_server, srv, mock_url, user_id, tool_name, tool_args):
    """Drive one console chat turn that forces a specific tool call."""
    srv.force_tool_call = True
    srv.tool_call_name = tool_name
    srv.tool_call_arguments = (
        tool_args if isinstance(tool_args, str) else json.dumps(tool_args)
    )
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    register_mock_provider(app_server, mock_url)

    submit = app_server.api_request(
        "POST",
        "/api/console/chat/task",
        json={
            "channel": "console",
            "user_id": user_id,
            "session_id": f"console:{user_id}",
            "input": [
                {
                    "role": "user",
                    "type": "message",
                    "content": [
                        {"type": "text", "text": "use the tool"},
                    ],
                },
            ],
            "request_context": {"approval_level": "off"},
        },
        timeout=_HTTP_TIMEOUT,
    )
    assert submit.status_code == 200, app_server.logs_tail()[-2000:]
    task_id = submit.json().get("task_id") or submit.json().get("id")
    assert task_id, submit.json()

    deadline = time.time() + 90.0
    last = None
    while time.time() < deadline:
        resp = app_server.api_request(
            "GET",
            f"/api/console/chat/task/{task_id}",
            timeout=_HTTP_TIMEOUT,
        )
        assert resp.status_code == 200, app_server.logs_tail()
        last = resp.json()
        if last.get("status") == "finished":
            return last
        time.sleep(0.5)
    raise AssertionError(f"tool turn not finished: {last}")


@pytest.mark.integration
@pytest.mark.p1
def test_get_current_time_tool_executes(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """get_current_time runs in the runtime and returns to the LLM."""
    srv, mock_url = mock_llm
    srv.force_error = False
    result = _chat_with_tool(
        app_server,
        srv,
        mock_url,
        "integ-tool-time",
        "get_current_time",
        {},
    )
    assert result.get("status") == "finished"
    srv.force_tool_call = False


@pytest.mark.integration
@pytest.mark.p1
def test_list_directory_tool_executes(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """list_directory walks the workspace dir in the subprocess."""
    srv, mock_url = mock_llm
    srv.force_error = False
    result = _chat_with_tool(
        app_server,
        srv,
        mock_url,
        "integ-tool-listdir",
        "list_directory",
        {"path": "."},
    )
    assert result.get("status") == "finished"
    srv.force_tool_call = False


@pytest.mark.integration
@pytest.mark.p1
def test_read_file_tool_executes(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """read_file reads a workspace file in the subprocess."""
    srv, mock_url = mock_llm
    srv.force_error = False
    result = _chat_with_tool(
        app_server,
        srv,
        mock_url,
        "integ-tool-readfile",
        "read_file",
        {"file_path": "AGENTS.md"},
    )
    assert result.get("status") == "finished"
    srv.force_tool_call = False


@pytest.mark.integration
@pytest.mark.p1
def test_read_file_tool_missing_file(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """read_file on an absent path exercises the error branch."""
    srv, mock_url = mock_llm
    srv.force_error = False
    result = _chat_with_tool(
        app_server,
        srv,
        mock_url,
        "integ-tool-readmissing",
        "read_file",
        {"file_path": "integ-absent-file-xyz.md"},
    )
    assert result.get("status") == "finished"
    srv.force_tool_call = False


@pytest.mark.integration
@pytest.mark.p1
def test_shell_tool_executes(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """execute_shell_command runs a benign command in the runtime."""
    srv, mock_url = mock_llm
    srv.force_error = False
    result = _chat_with_tool(
        app_server,
        srv,
        mock_url,
        "integ-tool-shell",
        "execute_shell_command",
        {"command": "echo integ-shell-probe"},
    )
    assert result.get("status") == "finished"
    srv.force_tool_call = False
