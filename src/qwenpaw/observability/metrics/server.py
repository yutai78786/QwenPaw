# -*- coding: utf-8 -*-
"""Dedicated metrics HTTP server on port 9090 (v2.0 §5.1).

Serves exactly two endpoints — ``/metrics`` (Prometheus scrape) and
``/healthz`` (liveness) — on its own asyncio server, isolated from the
business API on 8088.

Deployment contract:

- bind ``0.0.0.0:9090``; Pod template declares ``containerPort: 9090
  name: metrics`` (NetworkPolicy restricts access to the scraper)
- port conflict or bind failure degrades to a warning log — the
  business API must keep starting (v2.0 §5.1)
- shutdown stops the metrics server first (before business teardown),
  so in-flight scrapes never race the business shutdown path
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    generate_latest,
)

from .config import metrics_port
from .registry import REGISTRY, UPTIME_SECONDS

logger = logging.getLogger(__name__)

_HEALTHZ_BODY = b"OK\n"
_NOT_FOUND_BODY = b"Not Found\n"


def _http_response(status_line: str, content_type: str, body: bytes) -> bytes:
    """Build a minimal HTTP/1.1 response."""
    return (
        f"HTTP/1.1 {status_line}\r\n"
        f"Content-Type: {content_type}\r\n"
        f"Content-Length: {len(body)}\r\n"
        "Connection: close\r\n"
        "\r\n"
    ).encode() + body


class MetricsServer:
    """Asyncio TCP server speaking just enough HTTP for a scraper."""

    def __init__(self, port: Optional[int] = None) -> None:
        self._port = port if port is not None else metrics_port()
        self._server: Optional[asyncio.Server] = None
        self._started_at = time.monotonic()

    @property
    def port(self) -> int:
        return self._port

    @property
    def running(self) -> bool:
        return self._server is not None

    async def start(self) -> bool:
        """Start listening; returns False (and logs) on failure."""
        try:
            self._server = await asyncio.start_server(
                self._handle_connection,
                "0.0.0.0",
                self._port,
            )
        except OSError as exc:
            logger.warning(
                "Metrics server could not bind port %s (%s); metrics "
                "exposition disabled for this instance — business API "
                "continues unaffected.",
                self._port,
                exc,
            )
            self._server = None
            return False
        logger.info("Metrics server listening on 0.0.0.0:%s", self._port)
        return True

    async def stop(self) -> None:
        """Stop accepting and close; idempotent."""
        server, self._server = self._server, None
        if server is None:
            return
        server.close()
        try:
            await asyncio.wait_for(server.wait_closed(), timeout=5.0)
        except (asyncio.TimeoutError, OSError):
            logger.debug(
                "Metrics server close did not settle; moving on",
                exc_info=True,
            )
        logger.info("Metrics server stopped")

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            request_line = await asyncio.wait_for(
                reader.readline(),
                timeout=10.0,
            )
            method, path = self._parse_request_line(request_line)
            if method != "GET":
                body = _NOT_FOUND_BODY
                writer.write(
                    _http_response(
                        "405 Method Not Allowed",
                        "text/plain",
                        body,
                    ),
                )
            elif path == "/metrics":
                body = self._render_metrics()
                writer.write(
                    _http_response("200 OK", CONTENT_TYPE_LATEST, body),
                )
            elif path == "/healthz":
                writer.write(
                    _http_response("200 OK", "text/plain", _HEALTHZ_BODY),
                )
            else:
                writer.write(
                    _http_response(
                        "404 Not Found",
                        "text/plain",
                        _NOT_FOUND_BODY,
                    ),
                )
            await writer.drain()
        except (asyncio.TimeoutError, ConnectionError, OSError, ValueError):
            logger.debug("metrics connection dropped", exc_info=True)
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    @staticmethod
    def _parse_request_line(line: bytes) -> tuple[str, str]:
        parts = line.decode("latin-1").strip().split(" ")
        if len(parts) < 2:
            raise ValueError("malformed request line")
        method = parts[0]
        path = parts[1].split("?", 1)[0]
        return method, path

    def _render_metrics(self) -> bytes:
        UPTIME_SECONDS.set(time.monotonic() - self._started_at)
        return generate_latest(REGISTRY)
