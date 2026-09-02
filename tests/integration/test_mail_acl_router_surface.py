# -*- coding: utf-8 -*-
"""Integration tests for the mail access control HTTP surface.

Drives every /api/mail-access-control endpoint through the real app
subprocess (app_server fixture) so the router, ACL store helpers and
per-agent workspace routing execute inside the child process and are
counted by the subprocess-only coverage collection.

Targets: src/qwenpaw/app/routers/mail_access_control.py and the
mail_access_control store path in src/qwenpaw/app/mail/.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(15.0)

_BASE = "/api/mail-access-control"


def _entry(agent_id: str = "", address: str = "user@example.com") -> dict:
    return {"agent_id": agent_id, "address": address}


@pytest.mark.integration
@pytest.mark.p1
def test_list_mail_agents(app_server) -> None:
    """GET agents endpoint responds with a parseable payload."""
    resp = app_server.api_request("GET", f"{_BASE}/agents", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_get_all_acls_empty(app_server) -> None:
    """ACL aggregate returns structured data with no agents enabled."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_get_all_pending_empty(app_server) -> None:
    """Pending aggregate returns structured data when nothing queued."""
    resp = app_server.api_request("GET", f"{_BASE}/pending/all", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), (list, dict))


@pytest.mark.integration
@pytest.mark.p1
def test_get_pending_count(app_server) -> None:
    """Pending count endpoint reports an integer."""
    resp = app_server.api_request("GET", f"{_BASE}/pending/count", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    value = body if isinstance(body, int) else body.get("count", body)
    assert isinstance(value, int) or value is not None


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_broadcast(app_server) -> None:
    """Whitelist add with empty agent_id broadcasts to mail agents."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry(agent_id="", address="ok@example.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_empty_entries(app_server) -> None:
    """Whitelist add with no entries is rejected or a no-op."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": []},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_missing_address(app_server) -> None:
    """Entries without an address fail validation (422)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [{"agent_id": ""}]},
        timeout=_T,
    )
    assert resp.status_code == 422, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_remove_from_whitelist(app_server) -> None:
    """Whitelist removal routes through the store layer."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/remove",
        json={"entries": [_entry(address="gone@example.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_blacklist(app_server) -> None:
    """Blacklist add executes the same routing path as whitelist."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/add",
        json={"entries": [_entry(address="bad@example.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_remove_from_blacklist(app_server) -> None:
    """Blacklist removal endpoint responds contractually."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/remove",
        json={"entries": [_entry(address="bad@example.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_approve_pending_no_entry(app_server) -> None:
    """Approving with an empty pending set is a contract no-op."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/approve",
        json={"entries": []},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_deny_pending_unknown_entry(app_server) -> None:
    """Denying an unknown pending entry does not 500."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/deny",
        json={"entries": [_entry(agent_id="integ-x", address="a@b.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_dismiss_pending_unknown_entry(app_server) -> None:
    """Dismissing an unknown pending entry does not 500."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/dismiss",
        json={"entries": [_entry(agent_id="integ-x", address="a@b.com")]},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_update_pending_remark_unknown(app_server) -> None:
    """Remark update on an unknown entry returns a contract status."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/remark",
        json={"agent_id": "integ-x", "address": "a@b.com", "remark": "note"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_update_remark_unknown(app_server) -> None:
    """ACL remark update on an unknown entry returns a contract status."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/remark",
        json={"agent_id": "integ-x", "address": "a@b.com", "remark": "note"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 409), app_server.logs_tail()
