# -*- coding: utf-8 -*-
"""Tests for the ACS monitoring metrics contract (v2.0 §2 / §3 / §5.1).

Covers:
- allowlist mechanical mapping (method/route/status_class/model/channel)
- registry schema matches §2.1 exactly (no error counters)
- HTTP middleware counts once with allowlisted labels
- run observer: outcome four values, exactly-once, TTFT, active gauge
- metrics server serves /metrics + /healthz and rejects other paths
"""
# pylint: disable=protected-access,redefined-outer-name,unused-argument
from __future__ import annotations

import pytest
from prometheus_client import generate_latest

from qwenpaw.observability.metrics import allowlist
from qwenpaw.observability.metrics.registry import REGISTRY


# ---------------------------------------------------------------------------
# allowlist (§2.2)
# ---------------------------------------------------------------------------


def test_map_method_allowlist():
    assert allowlist.map_method("GET") == "GET"
    assert allowlist.map_method("post") == "POST"
    assert allowlist.map_method("HEAD") == "_other"
    assert allowlist.map_method(None) == "_other"
    assert allowlist.map_method("OPTIONS") == "_other"


def test_map_route_allowlist_and_other():
    assert allowlist.map_route("/api/console/chat") == "/api/console/chat"
    assert allowlist.map_route("/api/console/chat/task/{task_id}") == (
        "/api/console/chat/task/{task_id}"
    )
    # raw URL must never pass through
    assert allowlist.map_route("/api/console/chat?secret=abc") == "_other"
    assert allowlist.map_route("/api/some/unknown/path") == "_other"
    assert allowlist.map_route(None) == "_other"


def test_map_status_class():
    assert allowlist.map_status_class(200) == "2xx"
    assert allowlist.map_status_class(301) == "3xx"
    assert allowlist.map_status_class(404) == "4xx"
    assert allowlist.map_status_class(500) == "5xx"


def test_map_status_class_edge_cases():
    # 1xx and garbage go to 'other'
    assert allowlist.map_status_class(199) == "other"
    assert allowlist.map_status_class(None) == "other"


def test_map_model_family():
    assert allowlist.map_model_family("qwen3-max") == "qwen"
    assert allowlist.map_model_family("deepseek-v3") == "deepseek"
    assert allowlist.map_model_family("glm-4-plus") == "glm"
    assert allowlist.map_model_family("openai/gpt-4o") == "openai"
    assert allowlist.map_model_family("claude-4") == "other"
    assert allowlist.map_model_family(None) == "other"


def test_map_channel_normalization():
    assert allowlist.map_channel("console") == "console_sse"
    assert allowlist.map_channel("voice") == "voice_ws"
    assert allowlist.map_channel("dingtalk") == "dingtalk"
    assert allowlist.map_channel("feishu") == "feishu"
    assert allowlist.map_channel("slack") == "_other"
    assert allowlist.map_channel(None) == "_other"


def test_validate_outcome():
    for value in ("success", "error", "cancelled", "timeout"):
        assert allowlist.validate_outcome(value) == value
    with pytest.raises(ValueError):
        allowlist.validate_outcome("exploded")


# ---------------------------------------------------------------------------
# registry schema (§2.1)
# ---------------------------------------------------------------------------


def _exposed_metric_names() -> set:
    """Metric names as they appear in the exposition format."""
    names = set()
    for line in generate_latest(REGISTRY).decode().splitlines():
        if line.startswith("# TYPE "):
            names.add(line.split(" ")[2])
    return names


def test_registry_contains_no_error_counters():
    """v2.0: http_errors_total / http_client_errors_total are deleted."""
    names = _exposed_metric_names()
    assert "qwenpaw_http_errors_total" not in names
    assert "qwenpaw_http_client_errors_total" not in names
    assert not any("errors_total" in n for n in names if "http" in n)


def test_registry_has_expected_metric_names():
    names = _exposed_metric_names()
    expected = {
        "qwenpaw_http_requests_total",
        "qwenpaw_http_request_duration_seconds",
        "qwenpaw_runs_total",
        "qwenpaw_runs_active",
        "qwenpaw_run_duration_seconds",
        "qwenpaw_run_ttft_seconds",
        "qwenpaw_channel_messages_total",
        "qwenpaw_ws_connection_errors_total",
        "qwenpaw_llm_calls_total",
        "qwenpaw_llm_tokens_total",
        "qwenpaw_llm_call_duration_seconds",
        "qwenpaw_sse_connections_active",
        "qwenpaw_ws_connections_active",
        "qwenpaw_agents_loaded",
        "qwenpaw_uptime_seconds",
    }
    missing = expected - names
    assert not missing, f"missing metrics: {missing}"


def test_created_series_suppressed():
    """v2.0 §2.3: PROMETHEUS_DISABLE_CREATED_SERIES keeps _created out."""
    output = generate_latest(REGISTRY).decode()
    assert "_created" not in output


def test_active_series_count_matches_budget():
    """v2.0 §2.3: exactly 977 active series per Pod.

    Breakdown: http_requests 6*21*5=630, runs 4*5=20, channel_messages
    5*2=10, ws_errors 4, llm_calls 5*2=10, llm_tokens 5*2=10,
    http_duration 21, run_duration 5, run_ttft 5, llm_duration 5,
    duration histograms add _count/_sum (2x21 + 2x5 + 2x5 + 2x5),
    gauges 5.
    """
    output = generate_latest(REGISTRY).decode()
    sample_count = 0
    for line in output.splitlines():
        if line and not line.startswith("#"):
            sample_count += 1
    # §2.3 budget: 977 active series (time series), which equals
    # sample lines for counters/gauges plus bucket/count/sum lines
    # for histograms.
    assert sample_count == 977, sample_count
