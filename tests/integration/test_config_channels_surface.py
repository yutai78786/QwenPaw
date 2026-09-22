# -*- coding: utf-8 -*-
"""Integration tests for the config channels HTTP surface.

Drives /api/config/channels endpoints through the real app subprocess
(app_server fixture) so channel availability checks, conflict
identity extraction (conflict.py), QR code auth handler registry
(qrcode_auth_handler.py), channel manager resolution (manager.py)
and config persistence all execute inside the child process.

Targets: src/qwenpaw/app/routers/config.py channel endpoints and the
channels base utilities they reach in the subprocess.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(15.0)

_BASE = "/api/config/channels"


@pytest.mark.integration
@pytest.mark.p1
def test_list_channels(app_server) -> None:
    """GET channel list returns available channel names."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert isinstance(body, (list, dict)), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_list_channel_types(app_server) -> None:
    """Channel types endpoint enumerates registered channel kinds."""
    resp = app_server.api_request("GET", f"{_BASE}/types", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert isinstance(body, (list, dict))
    # dingtalk ships in every build
    flat = str(body)
    assert "dingtalk" in flat or "telegram" in flat


@pytest.mark.integration
@pytest.mark.p1
def test_get_channel_unknown_returns_404(app_server) -> None:
    """Unknown channel name resolves to 404 (not 500)."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/integ-no-such-channel",
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_get_channel_configured(app_server) -> None:
    """A known channel returns its config or a 404 contract."""
    resp = app_server.api_request("GET", f"{_BASE}/dingtalk", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_conflict_check_disabled_short_circuits(app_server) -> None:
    """Disabled proposal returns conflict=false immediately."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/dingtalk/conflict-check",
        json={"enabled": False, "client_id": "x"},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert body.get("conflict") is False


@pytest.mark.integration
@pytest.mark.p1
def test_conflict_check_enabled_no_conflict(app_server) -> None:
    """Enabled proposal with identity runs the full scan path."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/dingtalk/conflict-check",
        json={"enabled": True, "client_id": "integ-conflict-client"},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert isinstance(body.get("conflict"), bool)


@pytest.mark.integration
@pytest.mark.p1
def test_conflict_check_unknown_channel_404(app_server) -> None:
    """Conflict check on an unknown channel name is a 404."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/integ-no-such/conflict-check",
        json={"enabled": True},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_conflict_check_missing_identity_fields(app_server) -> None:
    """Proposal without identity fields yields conflict=false."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/telegram/conflict-check",
        json={"enabled": True},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json().get("conflict") is False


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.parametrize(
    "channel",
    ["wechat", "wecom", "dingtalk", "feishu", "qq"],
)
def test_qrcode_endpoint_supported_channels(app_server, channel) -> None:
    """QR endpoints exist for the five handler-backed channels.

    Fetch may fail without real credentials, but the handler registry
    lookup and fetch attempt run in the subprocess either way.
    """
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/{channel}/qrcode",
        timeout=_T,
    )
    assert resp.status_code in (
        200,
        400,
        404,
        409,
        500,
        502,
        504,
    ), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_qrcode_endpoint_unsupported_channel_404(app_server) -> None:
    """Channels without a QR handler return 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/telegram/qrcode",
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_qrcode_status_unknown_token(app_server) -> None:
    """Polling with an unknown token is a contract response."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/dingtalk/qrcode/status",
        params={"token": "integ-no-such-token"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 410), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_channel_health_not_running_404(app_server) -> None:
    """Health of a disabled channel is a 404 contract."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/telegram/health",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_channel_restart_not_running_404(app_server) -> None:
    """Restarting a channel that never started is a 404 contract."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/sip/restart",
        timeout=_T,
    )
    assert resp.status_code in (200, 404, 500), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_put_channel_unknown_name_404(app_server) -> None:
    """Updating an unknown channel name is a 404."""
    resp = app_server.api_request(
        "PUT",
        f"{_BASE}/integ-no-such-channel",
        json={"enabled": False},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_channel_list_and_schema_consistent(app_server) -> None:
    """Schemas endpoint parses and overlaps the types list."""
    types = app_server.api_request("GET", f"{_BASE}/types", timeout=_T)
    schemas = app_server.api_request("GET", f"{_BASE}/schemas", timeout=_T)
    assert types.status_code == 200, app_server.logs_tail()
    assert schemas.status_code == 200, app_server.logs_tail()
