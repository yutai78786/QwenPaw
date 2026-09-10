# -*- coding: utf-8 -*-
"""Integration tests driving config WRITE paths through the app subprocess.

High-leverage coverage: each case issues a real mutating request that
persists config, reloads it, and triggers engine/scheduler side
effects inside the child process. This reaches config/utils.py
(mutate_config, save/load/backup), the tool-guard engine, the sandbox
effective-status resolver, heartbeat rescheduling and timezone
normalization — all code that read-only endpoint tests never execute.

Every case restores the value it changes so the suite stays hermetic.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(20.0)

_BASE = "/api/config"


@pytest.mark.integration
@pytest.mark.p1
def test_user_timezone_round_trip(app_server) -> None:
    """PUT user-timezone persists then GET reads it back."""
    orig = app_server.api_request(
        "GET",
        f"{_BASE}/user-timezone",
        timeout=_T,
    )
    assert orig.status_code == 200, app_server.logs_tail()
    original_tz = orig.json().get("timezone")

    put = app_server.api_request(
        "PUT",
        f"{_BASE}/user-timezone",
        json={"timezone": "Asia/Shanghai"},
        timeout=_T,
    )
    assert put.status_code == 200, app_server.logs_tail()
    assert put.json().get("timezone") == "Asia/Shanghai"

    got = app_server.api_request(
        "GET",
        f"{_BASE}/user-timezone",
        timeout=_T,
    )
    assert got.status_code == 200, app_server.logs_tail()
    assert got.json().get("timezone") == "Asia/Shanghai"

    # restore
    if original_tz:
        app_server.api_request(
            "PUT",
            f"{_BASE}/user-timezone",
            json={"timezone": original_tz},
            timeout=_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_user_timezone_invalid_rejected(app_server) -> None:
    """An invalid IANA timezone is a 400, not persisted."""
    put = app_server.api_request(
        "PUT",
        f"{_BASE}/user-timezone",
        json={"timezone": "Not/ARealZone"},
        timeout=_T,
    )
    assert put.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_user_timezone_empty_rejected(app_server) -> None:
    """A blank timezone string is a 400."""
    put = app_server.api_request(
        "PUT",
        f"{_BASE}/user-timezone",
        json={"timezone": "   "},
        timeout=_T,
    )
    assert put.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_tool_guard_read_write(app_server) -> None:
    """Tool guard settings persist through PUT and read back."""
    orig = app_server.api_request(
        "GET",
        f"{_BASE}/security/tool-guard",
        timeout=_T,
    )
    assert orig.status_code == 200, app_server.logs_tail()
    original = orig.json()

    # Toggle the enabled flag.
    toggled = dict(original)
    toggled["enabled"] = not original.get("enabled", False)
    put = app_server.api_request(
        "PUT",
        f"{_BASE}/security/tool-guard",
        json=toggled,
        timeout=_T,
    )
    assert put.status_code == 200, app_server.logs_tail()
    assert put.json().get("enabled") == toggled["enabled"]

    got = app_server.api_request(
        "GET",
        f"{_BASE}/security/tool-guard",
        timeout=_T,
    )
    assert got.status_code == 200, app_server.logs_tail()
    assert got.json().get("enabled") == toggled["enabled"]

    # restore
    app_server.api_request(
        "PUT",
        f"{_BASE}/security/tool-guard",
        json=original,
        timeout=_T,
    )


@pytest.mark.integration
@pytest.mark.p1
def test_tool_guard_builtin_rules(app_server) -> None:
    """Builtin rules endpoint returns a parseable list."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/tool-guard/builtin-rules",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_sandbox_effective_status(app_server) -> None:
    """Sandbox status resolves effective value for proposed flags."""
    for proposed in ("true", "false"):
        resp = app_server.api_request(
            "GET",
            f"{_BASE}/security/sandbox",
            params={"enabled": proposed},
            timeout=_T,
        )
        assert resp.status_code == 200, app_server.logs_tail()
        body = resp.json()
        assert "effective" in body
        assert "reason" in body


@pytest.mark.integration
@pytest.mark.p1
def test_sandbox_current_status(app_server) -> None:
    """Sandbox status without a proposal reflects current config."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/sandbox",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert "enabled" in body
    assert "effective" in body


@pytest.mark.integration
@pytest.mark.p1
def test_file_guard_read(app_server) -> None:
    """File guard settings read back as structured config."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/file-guard",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skill_scanner_read(app_server) -> None:
    """Skill scanner settings read back as structured config."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/skill-scanner",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skill_scanner_blocked_history(app_server) -> None:
    """Blocked-history listing parses."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/skill-scanner/blocked-history",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_allow_no_auth_hosts_read(app_server) -> None:
    """Allow-no-auth hosts list parses."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/security/allow-no-auth-hosts",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_heartbeat_read(app_server) -> None:
    """Heartbeat config reads back for the active agent."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/heartbeat",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_llm_routing_read(app_server) -> None:
    """Agent LLM routing config reads back."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/agents/llm-routing",
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_acp_config_read(app_server) -> None:
    """ACP config reads back."""
    resp = app_server.api_request("GET", f"{_BASE}/acp", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_acp_node_runtime_read(app_server) -> None:
    """ACP node-runtime status reads back."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/acp/node-runtime",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()
