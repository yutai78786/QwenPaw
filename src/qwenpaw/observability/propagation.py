# -*- coding: utf-8 -*-
"""W3C Trace Context propagation helpers for observability.

Inter-agent HTTP calls (``chat_with_agent`` and friends) used to carry
only ``X-Agent-Id``, so a distributed trace could not span agents.
These helpers inject the W3C ``traceparent`` / ``tracestate`` headers
from the active OpenTelemetry context so child-agent runs link to the
caller's span.

When tracing is disabled there is no valid active span and injection
is a strict no-op (headers are returned unchanged).
"""
from __future__ import annotations

from typing import Dict


def inject_trace_context(headers: Dict[str, str]) -> Dict[str, str]:
    """Inject W3C ``traceparent`` / ``tracestate`` into *headers*.

    Mutates and returns *headers*. Uses the global OpenTelemetry
    propagator (TraceContext + Baggage by default). No-op when no
    valid span is active (e.g. tracing disabled), so callers can use
    this unconditionally.
    """
    # Lazy import: keep early-import cost and coupling out of hot paths.
    from opentelemetry import propagate, trace

    if trace.get_current_span().get_span_context().is_valid:
        propagate.inject(headers)
    return headers
