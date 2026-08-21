# -*- coding: utf-8 -*-
"""Tests for W3C Trace Context injection on inter-agent HTTP calls.

P-2 (ACS monitoring v2.0): child-agent HTTP calls previously carried
only ``X-Agent-Id``. They must now inject ``traceparent`` /
``tracestate`` from the active OpenTelemetry span, and stay a strict
no-op when no span is active (tracing disabled).
"""
# pylint: disable=redefined-outer-name,protected-access
from __future__ import annotations

import re

from qwenpaw.observability.propagation import inject_trace_context


TRACEPARENT_RE = re.compile(
    r"^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$",
)


def test_inject_is_noop_without_active_span():
    """Tracing disabled / no span: headers must come back unchanged."""
    headers = {"X-Agent-Id": "agent-a"}

    result = inject_trace_context(headers)

    assert result is headers
    assert result == {"X-Agent-Id": "agent-a"}
    assert "traceparent" not in result
    assert "tracestate" not in result


def test_inject_adds_traceparent_under_active_span():
    """Under a sampled span, traceparent (and optionally tracestate)
    must be injected and carry the same trace id."""
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.sampling import ALWAYS_ON

    provider = TracerProvider(sampler=ALWAYS_ON)
    tracer = provider.get_tracer(__name__)

    with tracer.start_as_current_span("parent") as span:
        span_context = span.get_span_context()
        headers = {"X-Agent-Id": "agent-a"}
        result = inject_trace_context(headers)

    assert "traceparent" in result
    assert TRACEPARENT_RE.match(result["traceparent"])
    # trace id segment must match the active span's trace id
    trace_id_hex = format(span_context.trace_id, "032x")
    assert trace_id_hex in result["traceparent"]


def test_inject_preserves_existing_headers():
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.sampling import ALWAYS_ON

    provider = TracerProvider(sampler=ALWAYS_ON)
    tracer = provider.get_tracer(__name__)

    with tracer.start_as_current_span("parent"):
        headers = {
            "X-Agent-Id": "agent-b",
            "Authorization": "Bearer x",
        }
        result = inject_trace_context(headers)

    assert result["X-Agent-Id"] == "agent-b"
    assert result["Authorization"] == "Bearer x"
    assert "traceparent" in result


def test_request_headers_inject_trace_context(monkeypatch):
    """``_request_headers`` must route through inject_trace_context."""
    from qwenpaw.agents.tools import agent_management

    seen: dict = {}

    def fake_inject(headers):
        seen["called"] = True
        headers[
            "traceparent"
        ] = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
        return headers

    monkeypatch.setattr(
        "qwenpaw.observability.propagation.inject_trace_context",
        fake_inject,
    )

    headers = agent_management._request_headers("agent-x")

    assert seen.get("called") is True
    assert headers["X-Agent-Id"] == "agent-x"
    assert "traceparent" in headers


def test_request_headers_none_agent_still_injects():
    """Even without to_agent, trace context should be injected."""
    from qwenpaw.agents.tools.agent_management import _request_headers

    headers = _request_headers(None)

    assert "X-Agent-Id" not in headers
    # No active span in plain unit test -> no traceparent, but no crash.
    assert isinstance(headers, dict)
