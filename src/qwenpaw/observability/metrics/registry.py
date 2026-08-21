# -*- coding: utf-8 -*-
"""Central Prometheus registry and metric declarations (v2.0 §2.1).

A dedicated ``CollectorRegistry`` is used so QwenPaw's metrics never
mix with process/platform defaults or any library that registers on
the global registry. The ``PROMETHEUS_DISABLE_CREATED_SERIES`` env var
is forced on *before* any metric is created so the expensive per-series
``_created`` timestamps are never exported (v2.0 §2.3 cardinality).

Label values are always bounded: see
:mod:`qwenpaw.observability.metrics.allowlist`. No ``trace_id`` /
``session_id`` / ``run_id`` / ``user_id`` / ``request_id`` may ever
appear as a label (v2.0 §2.1).
"""
from __future__ import annotations

import os

# Must be set before any prometheus metric object is constructed so the
# per-series _created sample is suppressed at generation time. The env
# var covers processes where nothing else imports prometheus_client
# first; the explicit function call below makes the suppression
# import-order-independent (prometheus_client resolves the flag at
# module import time).
os.environ.setdefault("PROMETHEUS_DISABLE_CREATED_SERIES", "True")

# pylint: disable=wrong-import-position
from prometheus_client import (  # noqa: E402
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    disable_created_metrics,
)

# Import-order-independent suppression of the per-series _created
# samples (v2.0 §2.3: +720 series per combination is forbidden).
disable_created_metrics()

#: Dedicated registry — never the global default.
REGISTRY = CollectorRegistry()

# ---------------------------------------------------------------------------
# HTTP (v2.0 §2.1). Errors are derived from requests_total{status_class};
# there is intentionally NO http_errors_total / http_client_errors_total.
# ---------------------------------------------------------------------------
HTTP_REQUESTS_TOTAL = Counter(
    "qwenpaw_http_requests_total",
    "HTTP requests served by the business API.",
    ["method", "route", "status_class"],
    registry=REGISTRY,
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "qwenpaw_http_request_duration_seconds",
    "HTTP request latency in seconds.",
    ["route"],
    registry=REGISTRY,
    buckets=(0.01, 0.1, 0.5, 1.0, 5.0),
)

# ---------------------------------------------------------------------------
# Run lifecycle (v2.0 §3, observed at Workspace.stream_query).
# ---------------------------------------------------------------------------
RUNS_TOTAL = Counter(
    "qwenpaw_runs_total",
    "Agent runs that reached a terminal state.",
    ["outcome", "channel"],
    registry=REGISTRY,
)

RUNS_ACTIVE = Gauge(
    "qwenpaw_runs_active",
    "Agent runs currently in flight.",
    registry=REGISTRY,
)

RUN_DURATION_SECONDS = Histogram(
    "qwenpaw_run_duration_seconds",
    "End-to-end run latency in seconds.",
    ["channel"],
    registry=REGISTRY,
    buckets=(1.0, 5.0, 30.0, 120.0, 600.0),
)

RUN_TTFT_SECONDS = Histogram(
    "qwenpaw_run_ttft_seconds",
    "Time to first non-empty content delta, in seconds.",
    ["channel"],
    registry=REGISTRY,
    buckets=(1.0, 5.0, 30.0, 120.0, 600.0),
)

# ---------------------------------------------------------------------------
# Channel transport.
# ---------------------------------------------------------------------------
CHANNEL_MESSAGES_TOTAL = Counter(
    "qwenpaw_channel_messages_total",
    "Channel messages by direction.",
    ["channel", "direction"],
    registry=REGISTRY,
)

WS_CONNECTION_ERRORS_TOTAL = Counter(
    "qwenpaw_ws_connection_errors_total",
    "WebSocket connection errors by type.",
    ["error_type"],
    registry=REGISTRY,
)

# ---------------------------------------------------------------------------
# LLM calls.
# ---------------------------------------------------------------------------
LLM_CALLS_TOTAL = Counter(
    "qwenpaw_llm_calls_total",
    "LLM calls by model family and status.",
    ["model_family", "status"],
    registry=REGISTRY,
)

LLM_TOKENS_TOTAL = Counter(
    "qwenpaw_llm_tokens_total",
    "LLM tokens by model family and type (prompt/completion).",
    ["model_family", "type"],
    registry=REGISTRY,
)

LLM_CALL_DURATION_SECONDS = Histogram(
    "qwenpaw_llm_call_duration_seconds",
    "LLM call latency in seconds.",
    ["model_family"],
    registry=REGISTRY,
    buckets=(1.0, 5.0, 10.0, 30.0, 60.0),
)

# ---------------------------------------------------------------------------
# Connectivity / capacity gauges (v2.0 §2.1 Gauge×4).
# ---------------------------------------------------------------------------
SSE_CONNECTIONS_ACTIVE = Gauge(
    "qwenpaw_sse_connections_active",
    "Active SSE (console streaming) connections.",
    registry=REGISTRY,
)

WS_CONNECTIONS_ACTIVE = Gauge(
    "qwenpaw_ws_connections_active",
    "Active WebSocket connections.",
    registry=REGISTRY,
)

AGENTS_LOADED = Gauge(
    "qwenpaw_agents_loaded",
    "Number of loaded agent workspaces.",
    registry=REGISTRY,
)

UPTIME_SECONDS = Gauge(
    "qwenpaw_uptime_seconds",
    "Seconds since process start.",
    registry=REGISTRY,
)


def preinitialize_series() -> None:
    """Pre-create the full bounded series space at import time.

    Every label combination from the §2.2 allowlists is instantiated
    with value zero so a scrape always exposes the exact §2.3 budget
    (977 active series per Pod) from the first request onward —
    cardinality can never grow beyond it, and canary validation becomes
    a direct count. Idempotent; called once at import.
    """
    from .allowlist import (  # pylint: disable=import-outside-toplevel
        CHANNEL_VALUES,
        DIRECTION_VALUES,
        LLM_STATUS_VALUES,
        LLM_TOKEN_TYPE_VALUES,
        METHOD_VALUES,
        MODEL_FAMILY_VALUES,
        OUTCOME_VALUES,
        ROUTE_VALUES,
        STATUS_CLASS_VALUES,
        WS_ERROR_TYPE_VALUES,
    )

    for method in METHOD_VALUES:
        for route in ROUTE_VALUES:
            for status_class in STATUS_CLASS_VALUES:
                HTTP_REQUESTS_TOTAL.labels(method, route, status_class)
    for route in ROUTE_VALUES:
        HTTP_REQUEST_DURATION_SECONDS.labels(route)
    for outcome in OUTCOME_VALUES:
        for channel in CHANNEL_VALUES:
            RUNS_TOTAL.labels(outcome, channel)
    for channel in CHANNEL_VALUES:
        RUN_DURATION_SECONDS.labels(channel)
        RUN_TTFT_SECONDS.labels(channel)
        for direction in DIRECTION_VALUES:
            CHANNEL_MESSAGES_TOTAL.labels(channel, direction)
    for error_type in WS_ERROR_TYPE_VALUES:
        WS_CONNECTION_ERRORS_TOTAL.labels(error_type)
    for family in MODEL_FAMILY_VALUES:
        for status in LLM_STATUS_VALUES:
            LLM_CALLS_TOTAL.labels(family, status)
        for token_type in LLM_TOKEN_TYPE_VALUES:
            LLM_TOKENS_TOTAL.labels(family, token_type)
        LLM_CALL_DURATION_SECONDS.labels(family)


preinitialize_series()


__all__ = [
    "REGISTRY",
    "HTTP_REQUESTS_TOTAL",
    "HTTP_REQUEST_DURATION_SECONDS",
    "RUNS_TOTAL",
    "RUNS_ACTIVE",
    "RUN_DURATION_SECONDS",
    "RUN_TTFT_SECONDS",
    "CHANNEL_MESSAGES_TOTAL",
    "WS_CONNECTION_ERRORS_TOTAL",
    "LLM_CALLS_TOTAL",
    "LLM_TOKENS_TOTAL",
    "LLM_CALL_DURATION_SECONDS",
    "SSE_CONNECTIONS_ACTIVE",
    "WS_CONNECTIONS_ACTIVE",
    "AGENTS_LOADED",
    "UPTIME_SECONDS",
]
