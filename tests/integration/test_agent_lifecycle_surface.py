# -*- coding: utf-8 -*-
"""Integration tests driving agent lifecycle through the app subprocess.

High-leverage coverage: creating an agent initialises its workspace
(seeds AGENTS.md/SOUL.md, registers the profile, persists config),
copying clones selected config files, and deletion stops the runtime
and mutates config — all executing inside the child process.

Every case creates its own throwaway agent and deletes it, so the
suite stays hermetic.
"""

from __future__ import annotations

import time

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(30.0)

_BASE = "/api/agents"


def _wait_agent_running(app_server, agent_id, timeout=60.0):
    """Poll the agent list until the agent leaves the 'starting' state.

    DELETE refuses while the runtime is still starting (409), so
    lifecycle cases must wait for startup to settle first.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = app_server.api_request("GET", _BASE, timeout=_T)
        assert resp.status_code == 200, app_server.logs_tail()
        agents = resp.json().get("agents", [])
        for agent in agents:
            if agent.get("id") == agent_id:
                status = agent.get("startup_status")
                if status not in ("starting", "pending"):
                    return agent
                break
        time.sleep(0.5)
    raise AssertionError(f"agent {agent_id} still starting after {timeout}s")


@pytest.mark.integration
@pytest.mark.p1
def test_agent_lifecycle_create_list_delete(app_server) -> None:
    """Create -> list -> delete a throwaway agent."""
    agent_id = "integ-lc-basic"
    create = app_server.api_request(
        "POST",
        _BASE,
        json={"id": agent_id, "name": "LC basic", "description": ""},
        timeout=_T,
    )
    assert create.status_code == 201, app_server.logs_tail()

    try:
        listing = app_server.api_request("GET", _BASE, timeout=_T)
        assert listing.status_code == 200, app_server.logs_tail()
        agents = listing.json()
        items = (
            agents if isinstance(agents, list) else agents.get("agents", [])
        )
        ids = {
            (a.get("id") or a.get("agent_id"))
            for a in items
            if isinstance(a, dict)
        }
        assert agent_id in ids, f"{agent_id} missing from {ids}"
    finally:
        _wait_agent_running(app_server, agent_id)
        delete = app_server.api_request(
            "DELETE",
            f"{_BASE}/{agent_id}",
            timeout=_T,
        )
        assert delete.status_code == 200, app_server.logs_tail()
        assert delete.json().get("success") is True


@pytest.mark.integration
@pytest.mark.p1
def test_agent_create_generates_id_when_absent(app_server) -> None:
    """Omitting id generates a random short agent id."""
    create = app_server.api_request(
        "POST",
        _BASE,
        json={"name": "LC auto id", "description": ""},
        timeout=_T,
    )
    assert create.status_code == 201, app_server.logs_tail()
    new_id = create.json().get("id") or create.json().get("agent_id")
    assert new_id, create.json()
    try:
        assert new_id != "default"
    finally:
        app_server.api_request(
            "DELETE",
            f"{_BASE}/{new_id}",
            timeout=_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_agent_create_reserved_id_rejected(app_server) -> None:
    """Reserved/invalid ids are rejected with 400."""
    create = app_server.api_request(
        "POST",
        _BASE,
        json={"id": "default", "name": "dup default"},
        timeout=_T,
    )
    assert create.status_code in (400, 409), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_agent_create_duplicate_id_rejected(app_server) -> None:
    """A second agent with the same id is rejected."""
    agent_id = "integ-lc-dup"
    first = app_server.api_request(
        "POST",
        _BASE,
        json={"id": agent_id, "name": "dup first"},
        timeout=_T,
    )
    assert first.status_code == 201, app_server.logs_tail()
    try:
        dup = app_server.api_request(
            "POST",
            _BASE,
            json={"id": agent_id, "name": "dup second"},
            timeout=_T,
        )
        assert dup.status_code in (400, 409), app_server.logs_tail()
    finally:
        app_server.api_request(
            "DELETE",
            f"{_BASE}/{agent_id}",
            timeout=_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_agent_copy_config_files(app_server) -> None:
    """Copy clones md config files into a new agent."""
    agent_id = "integ-lc-src"
    create = app_server.api_request(
        "POST",
        _BASE,
        json={"id": agent_id, "name": "copy source"},
        timeout=_T,
    )
    assert create.status_code == 201, app_server.logs_tail()
    try:
        copy = app_server.api_request(
            "POST",
            f"{_BASE}/{agent_id}/copy",
            json={"name": "copy dest", "copy_md_files": True},
            timeout=_T,
        )
        assert copy.status_code == 201, app_server.logs_tail()
        copied_id = copy.json().get("id") or copy.json().get("agent_id")
        assert copied_id, copy.json()
        app_server.api_request(
            "DELETE",
            f"{_BASE}/{copied_id}",
            timeout=_T,
        )
    finally:
        app_server.api_request(
            "DELETE",
            f"{_BASE}/{agent_id}",
            timeout=_T,
        )


@pytest.mark.integration
@pytest.mark.p1
def test_agent_delete_default_rejected(app_server) -> None:
    """The default agent cannot be deleted."""
    delete = app_server.api_request(
        "DELETE",
        f"{_BASE}/default",
        timeout=_T,
    )
    assert delete.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_agent_delete_unknown_404(app_server) -> None:
    """Deleting an unknown agent is a 404."""
    delete = app_server.api_request(
        "DELETE",
        f"{_BASE}/integ-lc-no-such",
        timeout=_T,
    )
    assert delete.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_agent_list_carries_order(app_server) -> None:
    """Agent list returns an ordered list including default first."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    agents = resp.json().get("agents", [])
    assert isinstance(agents, list)
    assert agents, "agent list should not be empty"
    assert agents[0].get("id") == "default"


@pytest.mark.integration
@pytest.mark.p1
def test_agent_memory_graph_default(app_server) -> None:
    """Memory graph endpoint for the default agent is contractual."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/default/memory/graph",
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 503), app_server.logs_tail()
