# -*- coding: utf-8 -*-
"""Metrics switches and server configuration.

All observability features are opt-in and default to disabled so an
untouched deployment behaves exactly as before.

Environment variables (v2.0 §4.4 / §5.1):

- ``QPQAT_METRICS_ENABLED`` (default ``false``): start the 9090
  metrics server and the HTTP/run observers.
- ``QPQAT_TRACING_ENABLED`` (default ``false``): enable OpenTelemetry
  tracing (§4, wired separately).
- ``QPQAT_METRICS_PORT`` (default ``9090``): metrics server bind port.

Labels are always bounded by the allowlists in
:mod:`qwenpaw.observability.metrics.allowlist` — raw request paths,
model names, exception text or identifiers never become label values.
"""
from __future__ import annotations

from qwenpaw.constant import EnvVarLoader

#: Master switch for the metrics server + observers. Default off.
METRICS_ENABLED_ENV = "QPQAT_METRICS_ENABLED"

#: Master switch for tracing. Default off.
TRACING_ENABLED_ENV = "QPQAT_TRACING_ENABLED"

#: Metrics server port (dedicated, business API stays on 8088).
METRICS_PORT_ENV = "QPQAT_METRICS_PORT"

DEFAULT_METRICS_PORT = 9090


def metrics_enabled() -> bool:
    """True when ``QPQAT_METRICS_ENABLED`` is truthy (default False)."""
    return EnvVarLoader.get_bool(METRICS_ENABLED_ENV, default=False)


def tracing_enabled() -> bool:
    """True when ``QPQAT_TRACING_ENABLED`` is truthy (default False)."""
    return EnvVarLoader.get_bool(TRACING_ENABLED_ENV, default=False)


def metrics_port() -> int:
    """Metrics server port, bounded to a valid TCP port."""
    return EnvVarLoader.get_int(
        METRICS_PORT_ENV,
        default=DEFAULT_METRICS_PORT,
        min_value=1,
        max_value=65535,
    )
