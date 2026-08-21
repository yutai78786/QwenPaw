# -*- coding: utf-8 -*-
"""HTTP request metrics middleware (v2.0 §2.1 / §2.2).

Mechanically maps every request onto the bounded allowlists:

- method → 6 values (GET/POST/PUT/DELETE/PATCH/_other)
- route → 21 values (20 key route templates + _other), taken from the
  matched Starlette route template *after* dispatch — the router
  populates ``scope["route"]`` while routing, and raw request URLs are
  never used
- status_class → 5 values (2xx/3xx/4xx/5xx/other)

Implemented as a pure ASGI middleware (not ``BaseHTTPMiddleware``) so
SSE streaming responses are never buffered or delayed: each request is
counted exactly once in ``finally`` after the downstream app returns,
and the latency observed is time-to-first-response-byte — the intended
semantics for the business API.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Callable, Optional

from .allowlist import map_method, map_route, map_status_class
from .registry import (
    HTTP_REQUEST_DURATION_SECONDS,
    HTTP_REQUESTS_TOTAL,
)

logger = logging.getLogger(__name__)

_API_PREFIX = "/api"


def normalize_route_template(
    request_path: str,
    template: Optional[str],
) -> Optional[str]:
    """Re-apply the ``/api`` mount prefix to a route template.

    Starlette's ``scope["route"].path`` drops prefixes added by
    ``include_router(prefix=...)``: a request for ``/api/console/chat``
    reports template ``/console/chat``. Routers mounted at the app root
    (e.g. the Twilio voice endpoints) keep their full template.
    """
    if template is None:
        return None
    if request_path.startswith(_API_PREFIX) and not template.startswith(
        _API_PREFIX
    ):
        return f"{_API_PREFIX}{template}"
    return template


class HttpMetricsMiddleware:
    """Pure ASGI middleware counting requests with allowlisted labels."""

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

        started_at = time.perf_counter()
        status_box = {"code": 500}

        async def send_wrapper(message: dict) -> None:
            if message.get("type") == "http.response.start":
                status_box["code"] = message.get("status", 500)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            try:
                route = scope.get("route")
                route_label = map_route(
                    normalize_route_template(
                        scope.get("path", ""),
                        getattr(route, "path", None),
                    ),
                )
                HTTP_REQUESTS_TOTAL.labels(
                    method=map_method(scope.get("method")),
                    route=route_label,
                    status_class=map_status_class(status_box["code"]),
                ).inc()
                HTTP_REQUEST_DURATION_SECONDS.labels(
                    route=route_label
                ).observe(
                    time.perf_counter() - started_at,
                )
            except Exception:  # pylint: disable=broad-except
                # Metrics must never break request handling.
                logger.debug(
                    "http metrics recording failed",
                    exc_info=True,
                )
