# -*- coding: utf-8 -*-
"""Integration tests driving real conversations through the app subprocess.

High-leverage coverage: every case spins up the real agent runtime via
the console channel with a mock LLM (helpers.MockLLMHandler), so the
runtime loop, tool execution, model factory and reply formatting all
execute inside the child process and are counted by the subprocess
coverage collection.

Targets reached: src/qwenpaw/runtime/* (agent loop),
src/qwenpaw/agents/model_factory.py, tool execution paths, channel
outbound formatting.
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

_HTTP_TIMEOUT = default_http_timeout(20.0)


@pytest.fixture(scope="module")
def mock_llm():
    """Module-scoped mock OpenAI streaming server."""
    srv = HTTPServer(("127.0.0.1", 0), MockLLMHandler)
    srv.force_error = False
    srv.force_tool_call = False
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, f"http://127.0.0.1:{port}/v1"
    srv.shutdown()


def _submit_chat_task(app_server, user_id, text):
    """POST /api/console/chat/task and return (task_id, session_id)."""
    session_id = f"integ-run-{user_id}"
    body = {
        "channel": "console",
        "user_id": user_id,
        "session_id": session_id,
        "input": [
            {
                "role": "user",
                "type": "message",
                "content": [{"type": "text", "text": text}],
            },
        ],
    }
    resp = app_server.api_request(
        "POST",
        "/api/console/chat/task",
        json=body,
        timeout=_HTTP_TIMEOUT,
    )
    assert resp.status_code in (200, 202), app_server.logs_tail()
    payload = resp.json()
    return payload.get("task_id") or payload.get("id"), session_id


def _wait_finished(app_server, task_id, timeout=90.0):
    """Poll the chat task until finished."""
    deadline = time.time() + timeout
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
    raise AssertionError(f"task {task_id} not finished: {last}")


@pytest.mark.integration
@pytest.mark.p1
def test_plain_conversation_round_trip(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """A plain text conversation runs the full runtime loop."""
    srv, mock_url = mock_llm
    srv.force_error = False
    srv.force_tool_call = False
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    register_mock_provider(app_server, mock_url)
    task_id, _ = _submit_chat_task(app_server, "integ-run-plain", "hello")
    result = _wait_finished(app_server, task_id)
    assert result.get("status") == "finished"


@pytest.mark.integration
@pytest.mark.p1
def test_tool_calling_conversation(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """Drive the LLM to call a tool; the runtime executes it in-loop."""
    srv, mock_url = mock_llm
    srv.force_error = False
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    register_mock_provider(app_server, mock_url)
    srv.force_tool_call = True
    srv.tool_call_name = "get_current_time"
    srv.tool_call_arguments = json.dumps({})
    try:
        task_id, _ = _submit_chat_task(
            app_server,
            "integ-run-tool",
            "what time is it",
        )
        result = _wait_finished(app_server, task_id)
        assert result.get("status") == "finished"
    finally:
        srv.force_tool_call = False


@pytest.mark.integration
@pytest.mark.p1
def test_llm_error_then_recovery(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """A transient 429 followed by success exercises retry handling."""
    srv, mock_url = mock_llm
    srv.force_tool_call = False
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    register_mock_provider(app_server, mock_url)
    srv.force_status_code = [429]
    try:
        task_id, _ = _submit_chat_task(
            app_server,
            "integ-run-retry",
            "hello again",
        )
        result = _wait_finished(app_server, task_id, timeout=120.0)
        assert result.get("status") == "finished"
    finally:
        srv.force_status_code = None


@pytest.mark.integration
@pytest.mark.p1
def test_multi_turn_conversation(
    app_server,
    mock_llm,  # pylint: disable=redefined-outer-name
) -> None:
    """Two turns in one session exercise history replay."""
    srv, mock_url = mock_llm
    srv.force_error = False
    srv.force_tool_call = False
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    register_mock_provider(app_server, mock_url)

    user_id = "integ-run-multi"
    task_id, _ = _submit_chat_task(app_server, user_id, "turn one")
    _wait_finished(app_server, task_id)

    task_id2, _ = _submit_chat_task(app_server, user_id, "turn two")
    result = _wait_finished(app_server, task_id2)
    assert result.get("status") == "finished"
