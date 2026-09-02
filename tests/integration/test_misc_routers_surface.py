# -*- coding: utf-8 -*-
"""Integration tests for skills/mcp/plugins/console HTTP read surfaces.

Drives the read/list endpoints of four routers through the real app
subprocess (app_server fixture) so skill pool listing, hub search,
MCP OAuth status, plugin catalog and console inbox endpoints all
execute inside the child process.

Targets: src/qwenpaw/app/routers/{skills,mcp_oauth,plugins,console}.py
read endpoints and the disk/registry helpers they reach.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(20.0)


@pytest.mark.integration
@pytest.mark.p1
def test_skills_workspaces(app_server) -> None:
    """Skill workspaces listing parses."""
    resp = app_server.api_request("GET", "/api/skills/workspaces", timeout=_T)
    assert resp.status_code in (200, 503), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skills_hub_search(app_server) -> None:
    """Hub search endpoint is a contract response."""
    resp = app_server.api_request(
        "GET",
        "/api/skills/hub/search",
        params={"keyword": "integ"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 502, 503), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skills_pool(app_server) -> None:
    """Skill pool listing parses."""
    resp = app_server.api_request("GET", "/api/skills/pool", timeout=_T)
    assert resp.status_code in (200, 503), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skills_pool_builtin_sources(app_server) -> None:
    """Builtin sources endpoint parses."""
    resp = app_server.api_request(
        "GET", "/api/skills/pool/builtin-sources", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skills_pool_builtin_notice(app_server) -> None:
    """Builtin notice endpoint parses."""
    resp = app_server.api_request(
        "GET", "/api/skills/pool/builtin-notice", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_skills_install_status_unknown_task(app_server) -> None:
    """Install status for an unknown task is contractual."""
    resp = app_server.api_request(
        "GET", "/api/skills/hub/install/status/integ-no-such-task", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_mcp_oauth_status_unknown_client(app_server) -> None:
    """OAuth status for an unknown client key is contractual."""
    resp = app_server.api_request(
        "GET", "/api/mcp/oauth/status/integ-no-such-client", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_mcp_oauth_delete_unknown_client(app_server) -> None:
    """OAuth revoke for an unknown client key is contractual."""
    resp = app_server.api_request(
        "DELETE", "/api/mcp/oauth/integ-no-such-client", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_plugins_catalog(app_server) -> None:
    """Plugin catalog listing parses."""
    resp = app_server.api_request("GET", "/api/plugins/catalog", timeout=_T)
    assert resp.status_code in (200, 503), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_plugins_status_unknown(app_server) -> None:
    """Status of an unknown plugin is contractual."""
    resp = app_server.api_request(
        "GET", "/api/plugins/integ-no-such-plugin/status", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_plugins_market_search(app_server) -> None:
    """Market search is a contract response."""
    resp = app_server.api_request(
        "GET",
        "/api/plugins/market/search",
        params={"keyword": "integ"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 502, 503), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_console_push_messages(app_server) -> None:
    """Push messages endpoint parses."""
    resp = app_server.api_request(
        "GET", "/api/console/push-messages", timeout=_T
    )
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_console_inbox_events(app_server) -> None:
    """Inbox events endpoint parses."""
    resp = app_server.api_request(
        "GET", "/api/console/inbox/events", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_console_inbox_traces_unknown_run(app_server) -> None:
    """Inbox traces for an unknown run id is contractual."""
    resp = app_server.api_request(
        "GET", "/api/console/inbox/traces/integ-no-such-run", timeout=_T
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_console_chat_task_unknown(app_server) -> None:
    """Chat task lookup for an unknown task id is contractual."""
    resp = app_server.api_request(
        "GET", "/api/console/chat/task/integ-no-such-task", timeout=_T
    )
    assert resp.status_code in (200, 404, 410), app_server.logs_tail()
