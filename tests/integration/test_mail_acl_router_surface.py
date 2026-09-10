# -*- coding: utf-8 -*-
"""Integration tests for the mail access control HTTP surface.

Drives every /api/mail-access-control endpoint through the real app
subprocess (app_server fixture) so the router, the ACL store and the
address validator execute inside the child process and are counted by
the subprocess-only coverage collection.

Assertions verify real behaviour, not just "some acceptable status
code". In particular the write endpoints are checked through their
``count`` field: ``count: 1`` proves the entry actually landed in the
agent's ACL store, while ``count: 0`` proves a broadcast/unknown-agent
no-op. The malformed-address cases assert the 400 detail emitted by
``mail_access_control.validate_acl_address`` - a path the former
in-process ``*_module.py`` file could never reach, because it called the
validator directly instead of through the router's 400 guard.

Targets: src/qwenpaw/app/routers/mail_access_control.py and the
mail_access_control store + validator in src/qwenpaw/app/mail/.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(15.0)

_BASE = "/api/mail-access-control"
# A real registered agent, so writes actually persist (an empty agent_id
# broadcasts to the - empty - set of mail-enabled agents and stores
# nothing, which would let every case pass while covering no store code).
_AGENT = "default"


def _entry(address: str, agent_id: str = _AGENT) -> dict:
    return {"agent_id": agent_id, "address": address}


# ------------------------------------------------------------------ #
# read endpoints
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_list_mail_agents_empty_when_none_enabled(app_server) -> None:
    """No agent has mail ACL enabled, so the agent list is empty."""
    resp = app_server.api_request("GET", f"{_BASE}/agents", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"agents": []}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_get_all_acls_empty(app_server) -> None:
    """Aggregate ACL view is empty while no mail agent is enabled."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_get_all_pending_empty(app_server) -> None:
    """Aggregate pending view is empty when nothing is queued."""
    resp = app_server.api_request("GET", f"{_BASE}/pending/all", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == [], resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_get_pending_count_is_zero(app_server) -> None:
    """Pending count is 0 with an empty queue."""
    resp = app_server.api_request("GET", f"{_BASE}/pending/count", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    value = body if isinstance(body, int) else body.get("count")
    assert value == 0, body


# ------------------------------------------------------------------ #
# whitelist write path - count proves the store mutation
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_persists_one_entry(app_server) -> None:
    """A valid whitelist add stores exactly one entry (count == 1)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry("persist@example.com")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 1}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_unknown_agent_is_noop(app_server) -> None:
    """An agent with no mailbox stores nothing (count == 0)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry("x@example.com", agent_id="no-such-agent")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 0}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_whitelist_empty_entries_is_noop(app_server) -> None:
    """No entries means nothing stored (count == 0)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": []},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 0}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_add_missing_agent_id_is_422(app_server) -> None:
    """agent_id is required; omitting it fails schema validation."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [{"address": "ok@example.com"}]},
        timeout=_T,
    )
    assert resp.status_code == 422, app_server.logs_tail()
    assert "agent_id" in resp.text, resp.text


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.parametrize(
    "bad",
    ["not-an-email", "", "@bad", "no-at-sign", "a@@b.com"],
)
def test_add_malformed_address_is_400(app_server, bad: str) -> None:
    """The router's validator rejects a bad address with 400 + detail.

    This is the path the in-process module file never reached: it called
    validate_acl_address directly. Here the request goes through the
    HTTP guard, so the 400 mapping is exercised too.
    """
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry(bad)]},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()
    assert "Invalid email address" in resp.text, resp.text


@pytest.mark.integration
@pytest.mark.p1
def test_add_wildcard_domain_address_is_400_or_ok(app_server) -> None:
    """A ``*@domain`` wildcard is accepted by the validator (count 1)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry("*@example.com")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json()["count"] == 1, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_remove_from_whitelist_persists(app_server) -> None:
    """Removing a previously added entry reports count == 1."""
    app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry("remove-me@example.com")]},
        timeout=_T,
    )
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/remove",
        json={"entries": [_entry("remove-me@example.com")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 1}, resp.json()


# ------------------------------------------------------------------ #
# blacklist write path
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_add_to_blacklist_persists_one_entry(app_server) -> None:
    """A valid blacklist add stores exactly one entry."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/add",
        json={"entries": [_entry("block@example.com")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 1}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_blacklist_malformed_address_is_400(app_server) -> None:
    """Blacklist add shares the validator and rejects bad addresses."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/add",
        json={"entries": [_entry("not-an-email")]},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()
    assert "Invalid email address" in resp.text, resp.text


@pytest.mark.integration
@pytest.mark.p1
def test_remove_from_blacklist_persists(app_server) -> None:
    """Removing a previously blocked entry reports count == 1."""
    app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/add",
        json={"entries": [_entry("unblock@example.com")]},
        timeout=_T,
    )
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/blacklist/remove",
        json={"entries": [_entry("unblock@example.com")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 1}, resp.json()


# ------------------------------------------------------------------ #
# pending management
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_approve_pending_empty_is_noop(app_server) -> None:
    """Approving an empty pending set is a no-op (count == 0)."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/approve",
        json={"entries": []},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 0}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_deny_pending_unknown_entry_is_noop(app_server) -> None:
    """Denying a pending entry that does not exist is a no-op, not 500."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/deny",
        json={"entries": [_entry("ghost@b.com", agent_id="integ-x")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 0}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_dismiss_pending_unknown_entry_is_noop(app_server) -> None:
    """Dismissing a non-existent pending entry is a no-op, not 500."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/dismiss",
        json={"entries": [_entry("ghost@b.com", agent_id="integ-x")]},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok", "count": 0}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_update_pending_remark_unknown_is_404(app_server) -> None:
    """Remarking a pending entry that is absent returns 404."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/pending/remark",
        json={"agent_id": "integ-x", "address": "a@b.com", "remark": "note"},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()
    assert "not found" in resp.text.lower(), resp.text


# ------------------------------------------------------------------ #
# remark on the ACL lists
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_update_remark_on_existing_entry(app_server) -> None:
    """Remarking a stored whitelist entry succeeds."""
    app_server.api_request(
        "POST",
        f"{_BASE}/whitelist/add",
        json={"entries": [_entry("remark@example.com")]},
        timeout=_T,
    )
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/remark",
        json={
            "agent_id": _AGENT,
            "address": "remark@example.com",
            "remark": "note1",
        },
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json() == {"status": "ok"}, resp.json()


@pytest.mark.integration
@pytest.mark.p1
def test_update_remark_unknown_entry_is_404(app_server) -> None:
    """Remarking an address absent from every list returns 404."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/remark",
        json={"agent_id": "integ-x", "address": "a@b.com", "remark": "note"},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()
    assert "not found" in resp.text.lower(), resp.text
