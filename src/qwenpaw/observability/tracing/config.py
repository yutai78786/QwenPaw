# -*- coding: utf-8 -*-
"""Tracing switches and OTLP export configuration (v2.0 §4.3 / §4.4).

The master switch ``QPQAT_TRACING_ENABLED`` (default ``false``) is
defined alongside the metrics switches in
:mod:`qwenpaw.observability.metrics.config` and re-exported here so
both observability pillars share one isomorphic configuration style.

Export targets the first Collector tier (gateway). The gateway routes
spans by consistent hashing on trace ID to the second tier, which
applies tail sampling; a single-pod exporter therefore only needs the
gateway address (v2.0 §4.3).

Environment variables:

- ``QPQAT_TRACING_ENABLED`` (default ``false``): master switch.
- ``QPQAT_OTLP_ENDPOINT`` (default empty): first-tier Collector
  gateway address. With tracing enabled but no endpoint, spans are
  produced and dropped after processing with a one-time warning —
  the service never fails on tracing configuration.
- ``QPQAT_OTLP_PROTOCOL`` (default ``grpc``): ``grpc`` or ``http``.
"""
from __future__ import annotations

from typing import Optional

from qwenpaw.constant import EnvVarLoader

# Re-export the shared master switch (isomorphic with metrics).
from qwenpaw.observability.metrics.config import (
    TRACING_ENABLED_ENV,
    tracing_enabled,
)

__all__ = [
    "OTLP_ENDPOINT_ENV",
    "OTLP_PROTOCOL_ENV",
    "DEFAULT_OTLP_PROTOCOL",
    "TRACING_ENABLED_ENV",
    "otlp_endpoint",
    "otlp_protocol",
    "tracing_enabled",
]

#: First-tier Collector (gateway) endpoint for OTLP span export.
OTLP_ENDPOINT_ENV = "QPQAT_OTLP_ENDPOINT"

#: OTLP transport protocol: ``grpc`` (default) or ``http``.
OTLP_PROTOCOL_ENV = "QPQAT_OTLP_PROTOCOL"

DEFAULT_OTLP_PROTOCOL = "grpc"

_SUPPORTED_PROTOCOLS = ("grpc", "http")


def otlp_endpoint() -> Optional[str]:
    """First-tier Collector gateway endpoint, or ``None`` when unset."""
    value = EnvVarLoader.get_str(OTLP_ENDPOINT_ENV, default="").strip()
    return value or None


def otlp_protocol() -> str:
    """OTLP protocol, falling back to ``grpc`` for unknown values."""
    value = (
        EnvVarLoader.get_str(
            OTLP_PROTOCOL_ENV,
            default=DEFAULT_OTLP_PROTOCOL,
        )
        .strip()
        .lower()
    )
    return value if value in _SUPPORTED_PROTOCOLS else DEFAULT_OTLP_PROTOCOL
