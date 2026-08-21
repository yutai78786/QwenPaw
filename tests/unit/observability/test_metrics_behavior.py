# -*- coding: utf-8 -*-
"""Behavior tests: metrics server, HTTP middleware, run observer.

- MetricsServer (v2.0 §5.1): /metrics + /healthz only, port conflict
  degrades gracefully, shutdown is idempotent.
- HttpMetricsMiddleware (§2.2): exactly-once counting, allowlisted
  labels, no raw URL in labels.
- observe_stream_query (§3): dual-signal outcome, exactly-once,
  TTFT, active gauge balance.
"""
# pylint: disable=protected-access,redefined-outer-name,unused-argument
from __future__ import annotations

import asyncio
import socket
import urllib.error
import urllib.request

import pytest
from fastapi import FastAPI
from prometheus_client import generate_latest
from starlette.testclient import TestClient

from qwenpaw.observability.metrics.registry import (
    REGISTRY,
    RUNS_ACTIVE,
)
from qwenpaw.observability.metrics.run_observer import (
    observe_stream_query,
)
from qwenpaw.observability.metrics.server import MetricsServer
from qwenpaw.schemas import RunStatus


# ---------------------------------------------------------------------------
# MetricsServer (§5.1)
# ---------------------------------------------------------------------------


async def _get(port: int, path: str) -> tuple[int, str]:
    """HTTP GET against the local metrics server."""

    def _fetch() -> tuple[int, str]:
        url = f"http://127.0.0.1:{port}{path}"
        try:
            with urllib.request.urlopen(url, timeout=5) as resp:
                return resp.status, resp.read().decode()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode()

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _fetch)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.mark.asyncio
async def test_metrics_server_serves_metrics_and_healthz():
    port = _free_port()
    server = MetricsServer(port=port)
    assert await server.start() is True
    assert server.running is True
    try:
        status, body = await _get(port, "/metrics")
        assert status == 200
        assert "qwenpaw_http_requests_total" in body
        assert "qwenpaw_uptime_seconds" in body
        # no _created series
        assert "_created" not in body

        status, body = await _get(port, "/healthz")
        assert status == 200
        assert body.startswith("OK")

        status, _ = await _get(port, "/admin")
        assert status == 404

        status, _ = await _get(port, "/")
        assert status == 404
    finally:
        await server.stop()
    assert server.running is False
    # idempotent stop
    await server.stop()


@pytest.mark.asyncio
async def test_metrics_server_port_conflict_degrades_gracefully():
    port = _free_port()
    first = MetricsServer(port=port)
    second = MetricsServer(port=port)
    assert await first.start() is True
    try:
        # Bind failure must not raise (business API keeps starting).
        assert await second.start() is False
        assert second.running is False
    finally:
        await first.stop()


# ---------------------------------------------------------------------------
# HttpMetricsMiddleware (§2.2)
# ---------------------------------------------------------------------------


def _build_app() -> FastAPI:
    from qwenpaw.observability.metrics.http_middleware import (
        HttpMetricsMiddleware,
    )

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(HttpMetricsMiddleware)

    @app.post("/api/console/chat")
    async def chat():
        return {"ok": True}

    @app.get("/api/chats/{chat_id}")
    async def chat_detail(chat_id: str):
        return {"chat_id": chat_id}

    @app.get("/api/unknown/deep/path")
    async def unknown():
        return {"ok": True}

    return app


def _sample_value(text: str, prefix: str) -> float:
    for line in text.splitlines():
        if line.startswith(prefix):
            return float(line.rsplit(" ", 1)[1])
    raise AssertionError(f"sample not found: {prefix}")


def test_middleware_counts_with_allowlisted_labels():
    app = _build_app()
    client = TestClient(app)

    before = generate_latest(REGISTRY).decode()

    client.post("/api/console/chat")
    client.get("/api/chats/abc123")
    client.get("/api/chats/def456")
    client.get("/api/unknown/deep/path")

    after = generate_latest(REGISTRY).decode()

    key = (
        'qwenpaw_http_requests_total{method="POST",'
        'route="/api/console/chat",status_class="2xx"}'
    )
    assert _sample_value(after, key) - _sample_value(before, key) == 1.0

    key = (
        'qwenpaw_http_requests_total{method="GET",'
        'route="/api/chats/{chat_id}",status_class="2xx"}'
    )
    assert _sample_value(after, key) - _sample_value(before, key) == 2.0

    # unknown route collapses to _other; no raw URL in labels
    key = (
        'qwenpaw_http_requests_total{method="GET",'
        'route="_other",status_class="2xx"}'
    )
    assert _sample_value(after, key) - _sample_value(before, key) == 1.0
    assert "abc123" not in after
    assert "/api/unknown/deep/path" not in after


def test_middleware_counts_once_on_handler_error():
    """Exception in handler: counted once as 5xx, never twice."""
    from qwenpaw.observability.metrics.http_middleware import (
        HttpMetricsMiddleware,
    )

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(HttpMetricsMiddleware)

    @app.post("/api/console/chat/task")
    async def boom():
        raise RuntimeError("kaboom")

    client = TestClient(app, raise_server_exceptions=False)
    before = generate_latest(REGISTRY).decode()
    response = client.post("/api/console/chat/task")
    assert response.status_code == 500
    after = generate_latest(REGISTRY).decode()

    key = (
        'qwenpaw_http_requests_total{method="POST",'
        'route="/api/console/chat/task",status_class="5xx"}'
    )
    assert _sample_value(after, key) - _sample_value(before, key) == 1.0


# ---------------------------------------------------------------------------
# run observer (§3)
# ---------------------------------------------------------------------------


class _FakeResponse:
    object = "response"

    def __init__(self, status):
        self.status = status


class _FakeDelta:
    object = "content"
    delta = True

    def __init__(self, text: str):
        self.text = text


def _counter_value(text: str, prefix: str) -> float:
    for line in text.splitlines():
        if line.startswith(prefix):
            return float(line.rsplit(" ", 1)[1])
    raise AssertionError(f"sample not found: {prefix}")


async def test_observer_success_outcome_and_ttft():
    async def inner():
        await asyncio.sleep(0.01)
        yield _FakeDelta("hello")
        yield _FakeResponse(RunStatus.Completed)

    before = generate_latest(REGISTRY).decode()
    items = [
        item async for item in observe_stream_query("console_sse", inner())
    ]
    after = generate_latest(REGISTRY).decode()

    assert len(items) == 2

    key = 'qwenpaw_runs_total{channel="console_sse",outcome="success"}'
    assert _counter_value(after, key) - _counter_value(before, key) == 1.0
    assert "qwenpaw_run_ttft_seconds" in after
    # active gauge balanced
    assert RUNS_ACTIVE._value.get() == 0.0


async def test_observer_error_outcome_from_raised_exception():
    async def inner():
        yield _FakeDelta("partial")
        raise ValueError("model exploded")

    before = generate_latest(REGISTRY).decode()
    with pytest.raises(ValueError):
        async for _ in observe_stream_query("dingtalk", inner()):
            pass
    after = generate_latest(REGISTRY).decode()

    key = 'qwenpaw_runs_total{channel="dingtalk",outcome="error"}'
    assert _counter_value(after, key) - _counter_value(before, key) == 1.0
    assert RUNS_ACTIVE._value.get() == 0.0


async def test_observer_failed_envelope_maps_to_error():
    """Harness semantics: swallowed exception -> failed response."""

    async def inner():
        yield _FakeResponse(RunStatus.Failed)

    before = generate_latest(REGISTRY).decode()
    items = [item async for item in observe_stream_query("feishu", inner())]
    after = generate_latest(REGISTRY).decode()

    assert len(items) == 1
    key = 'qwenpaw_runs_total{channel="feishu",outcome="error"}'
    assert _counter_value(after, key) - _counter_value(before, key) == 1.0


async def test_observer_cancelled_outcome():
    async def inner():
        await asyncio.sleep(60)
        yield "never"

    before = generate_latest(REGISTRY).decode()

    async def consume():
        async for _ in observe_stream_query("console_sse", inner()):
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.02)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    after = generate_latest(REGISTRY).decode()
    key = 'qwenpaw_runs_total{channel="console_sse",outcome="cancelled"}'
    assert _counter_value(after, key) - _counter_value(before, key) == 1.0
    assert RUNS_ACTIVE._value.get() == 0.0


async def test_observer_timeout_outcome_via_typed_reason():
    """P-1 wiring: typed timeout reason -> outcome=timeout."""
    from qwenpaw.utils.cancellation import (
        CANCEL_REASON_TIMEOUT,
        cancellation_msg,
    )

    async def inner():
        await asyncio.sleep(60)
        yield "never"

    before = generate_latest(REGISTRY).decode()

    async def consume():
        async for _ in observe_stream_query("voice_ws", inner()):
            pass

    task = asyncio.create_task(consume())
    await asyncio.sleep(0.02)
    task.cancel(msg=cancellation_msg(CANCEL_REASON_TIMEOUT))
    with pytest.raises(asyncio.CancelledError):
        await task

    after = generate_latest(REGISTRY).decode()
    key = 'qwenpaw_runs_total{channel="voice_ws",outcome="timeout"}'
    assert _counter_value(after, key) - _counter_value(before, key) == 1.0
    assert RUNS_ACTIVE._value.get() == 0.0


async def test_observer_exactly_once_on_double_signal():
    """Native Runtime: emits completed envelope AND re-raises.

    Even when both signals fire, exactly one runs_total sample.
    """

    async def inner():
        yield _FakeResponse(RunStatus.Completed)
        raise RuntimeError("re-raise after envelope")

    before = generate_latest(REGISTRY).decode()
    with pytest.raises(RuntimeError):
        async for _ in observe_stream_query("console_sse", inner()):
            pass
    after = generate_latest(REGISTRY).decode()

    success_key = 'qwenpaw_runs_total{channel="console_sse",outcome="success"}'
    error_key = 'qwenpaw_runs_total{channel="console_sse",outcome="error"}'
    success_delta = _counter_value(after, success_key) - _counter_value(
        before,
        success_key,
    )
    error_delta = _counter_value(after, error_key) - _counter_value(
        before,
        error_key,
    )
    assert success_delta + error_delta == 1.0
    # exception signal wins when both fire
    assert error_delta == 1.0


async def test_observer_no_ttft_without_content_delta():
    async def inner():
        yield _FakeResponse(RunStatus.Failed)

    before = generate_latest(REGISTRY).decode()
    async for _ in observe_stream_query("console_sse", inner()):
        pass
    after = generate_latest(REGISTRY).decode()

    # ttft count must not grow when no content delta arrived
    def ttft_count(text: str) -> float:
        for line in text.splitlines():
            if line.startswith(
                'qwenpaw_run_ttft_seconds_count{channel="console_sse"}',
            ):
                return float(line.rsplit(" ", 1)[1])
        raise AssertionError("ttft count sample not found")

    assert ttft_count(after) == ttft_count(before)
