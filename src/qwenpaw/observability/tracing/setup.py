# -*- coding: utf-8 -*-
"""Tracer provider setup and OTLP export (v2.0 §4.3 / §4.4).

Installs a real SDK ``TracerProvider`` (which the middleware seam
detects via ``_sdk_tracing_active``) with a batched OTLP exporter
pointing at the first Collector tier (gateway). The gateway routes by
consistent hashing on trace ID; tail sampling happens on the second
tier, so no client-side sampling is applied here (§4.3).

Behaviour contract:

- off by default — called only when ``QPQAT_TRACING_ENABLED`` is true;
- idempotent: repeated calls reuse the installed provider;
- never raises: a misconfigured endpoint degrades to a warning and
  dropped spans; the service itself never fails on tracing setup;
- ``shutdown_tracing`` force-flushes and shuts the provider down
  (lifespan teardown, after the metrics server stops).
"""
from __future__ import annotations

import logging
import socket
from typing import Optional

from .config import otlp_endpoint, otlp_protocol

_logger = logging.getLogger(__name__)

#: Instrumentation scope / service name reported as ``service.name``.
SERVICE_NAME = "qwenpaw"

#: Override for ``service.instance.id`` (e.g. the Pod name in ACS).
SERVICE_INSTANCE_ID_ENV = "QPQAT_SERVICE_INSTANCE_ID"

_PROVIDER: Optional[object] = None


def setup_tracing() -> Optional[object]:
    """Install the global SDK tracer provider with OTLP export.

    Returns the installed provider, or ``None`` when export cannot be
    configured. Never raises.
    """
    global _PROVIDER
    if _PROVIDER is not None:
        return _PROVIDER

    try:
        from opentelemetry import trace as otel_trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        from qwenpaw.constant import EnvVarLoader
    except ImportError as exc:  # pragma: no cover - otel is a hard dep
        _logger.warning(
            "tracing: OpenTelemetry SDK unavailable (%s); spans disabled",
            exc,
        )
        return None

    instance_id = (
        EnvVarLoader.get_str(SERVICE_INSTANCE_ID_ENV, default="").strip()
        or socket.gethostname()
    )
    resource = Resource.create(
        {
            "service.name": SERVICE_NAME,
            "service.instance.id": instance_id,
        },
    )
    provider = TracerProvider(resource=resource)

    endpoint = otlp_endpoint()
    if endpoint is None:
        # Tracing enabled but no Collector gateway configured: spans
        # are produced and dropped. Warn once and install the provider
        # anyway so the middleware seam stays active for local spans.
        _logger.warning(
            "tracing: QPQAT_TRACING_ENABLED=true but %s is unset; "
            "spans will be dropped",
            "QPQAT_OTLP_ENDPOINT",
        )
    else:
        exporter = _build_exporter(endpoint)
        if exporter is None:
            _logger.warning(
                "tracing: OTLP exporter unavailable for endpoint=%s; "
                "spans will be dropped",
                endpoint,
            )
        else:
            provider.add_span_processor(BatchSpanProcessor(exporter))

    otel_trace.set_tracer_provider(provider)
    _PROVIDER = provider
    _logger.info(
        "tracing: SDK tracer provider installed (protocol=%s endpoint=%s)",
        otlp_protocol(),
        endpoint or "<unset>",
    )
    return provider


def _build_exporter(endpoint: str) -> Optional[object]:
    """Build the OTLP exporter for the configured protocol, or None."""
    protocol = otlp_protocol()
    try:
        if protocol == "http":
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (  # noqa: E501
                OTLPSpanExporter,
            )

            return OTLPSpanExporter(endpoint=endpoint)
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )

        return OTLPSpanExporter(endpoint=endpoint, insecure=True)
    except Exception as exc:  # pylint: disable=broad-except
        _logger.warning(
            "tracing: failed to build %s OTLP exporter: %s",
            protocol,
            type(exc).__qualname__,
        )
        return None


def shutdown_tracing() -> None:
    """Force-flush and shut down the provider (idempotent, safe)."""
    global _PROVIDER
    provider = _PROVIDER
    _PROVIDER = None
    if provider is None:
        return
    try:
        provider.shutdown()
    except Exception as exc:  # pylint: disable=broad-except
        _logger.warning("tracing: provider shutdown failed: %s", exc)
