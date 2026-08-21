# -*- coding: utf-8 -*-
"""Inbound W3C trace-context extraction middleware (v2.0 §4.2).

Completes the inter-agent trace link: the P-2 change injects
``traceparent`` / ``tracestate`` into outgoing inter-agent HTTP calls;
this pure ASGI middleware extracts them on the receiving side and
starts the SERVER root span, so one distributed trace spans all
agents in a delegation chain.

Span content stays metadata-only (§4.1): HTTP method, status code and
the matched route template (same bounded allowlist semantics as the
metrics middleware — raw request URLs never become span content).
Errors use the sanitized error path (no ``record_exception``).

Pure ASGI (not ``BaseHTTPMiddleware``) so SSE streaming is never
buffered; the context is detached in ``finally``.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from opentelemetry import context as otel_context
from opentelemetry import propagate, trace as otel_trace
from opentelemetry.trace import SpanKind, StatusCode

from .extractor import set_span_error

logger = logging.getLogger(__name__)

#: Attribute keys used by the server span (metadata-only).
HTTP_REQUEST_METHOD = "http.request.method"
HTTP_RESPONSE_STATUS_CODE = "http.response.status_code"
HTTP_ROUTE = "http.route"

_API_PREFIX = "/api"


def _normalize_route_template(
    request_path: str,
    template: Any,
) -> Any:
    """Re-apply the ``/api`` mount prefix (same rule as the metrics
    middleware; Starlette drops ``include_router`` prefixes)."""
    if template is None:
        return None
    template = str(template)
    if request_path.startswith(_API_PREFIX) and not template.startswith(
        _API_PREFIX,
    ):
        return f"{_API_PREFIX}{template}"
    return template


class HttpTracingMiddleware:
    """Pure ASGI middleware starting a SERVER span per request.

    Inbound ``traceparent`` / ``tracestate`` are extracted with the
    global propagator; a missing or invalid context simply starts a
    new root trace. The middleware itself never raises into request
    handling.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(
        self,
        scope: dict,
        receive: Callable,
        send: Callable,
    ) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        try:
            incoming_ctx = propagate.extract(
                {
                    key.decode("latin-1").lower(): value.decode("latin-1")
                    for key, value in scope.get("headers", [])
                },
            )
        except Exception:  # pylint: disable=broad-except
            incoming_ctx = None

        tracer = otel_trace.get_tracer("qwenpaw")
        method = str(scope.get("method", "")).upper() or "UNKNOWN"
        span = tracer.start_span(
            name=f"http {method}",
            kind=SpanKind.SERVER,
            attributes={HTTP_REQUEST_METHOD: method},
            context=incoming_ctx,
        )
        span_context = otel_trace.set_span_in_context(span, incoming_ctx)
        token = otel_context.attach(span_context)

        status_box = {"code": 500}

        async def send_wrapper(message: dict) -> None:
            if message.get("type") == "http.response.start":
                status_box["code"] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException as exc:
            set_span_error(span, exc)
            raise
        finally:
            otel_context.detach(token)
            try:
                status = int(status_box.get("code", 500))
            except (TypeError, ValueError):
                status = 500
            span.set_attribute(HTTP_RESPONSE_STATUS_CODE, status)
            route = scope.get("route")
            template = _normalize_route_template(
                scope.get("path", ""),
                getattr(route, "path", None),
            )
            if template is not None:
                span.set_attribute(HTTP_ROUTE, template)
            if status >= 500:
                span.set_status(StatusCode.ERROR)
            span.end()
