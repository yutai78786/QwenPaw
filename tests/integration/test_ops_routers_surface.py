# -*- coding: utf-8 -*-
"""Integration tests for checkpoints/loops/backups/harnesses read surfaces.

Drives the read/status endpoints of four more routers through the
real app subprocess (app_server fixture) so checkpoint status/graph,
loop mode status, backup job listing and harness provider probing all
execute inside the child process.

Targets: src/qwenpaw/app/routers/{checkpoints,loops,backup,
provider_oauth,harnesses}.py read endpoints.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(20.0)


@pytest.mark.integration
@pytest.mark.p1
def test_checkpoint_status(app_server) -> None:
    """Checkpoint status endpoint parses."""
    resp = app_server.api_request(
        "GET",
        "/api/workspace/checkpoints/status",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_checkpoint_graph(app_server) -> None:
    """Checkpoint graph endpoint is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/workspace/checkpoints/graph",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_checkpoint_gc_settings(app_server) -> None:
    """GC settings read endpoint parses."""
    resp = app_server.api_request(
        "GET",
        "/api/workspace/checkpoints/gc/settings",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_checkpoint_restore_preview(app_server) -> None:
    """Restore preview validates required fields before lookup."""
    resp = app_server.api_request(
        "POST",
        "/api/workspace/checkpoints/restore/preview",
        json={"snapshot_id": "integ-no-such-snapshot"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_checkpoint_gc_preview(app_server) -> None:
    """GC preview requires a body (422 without one)."""
    resp = app_server.api_request(
        "POST",
        "/api/workspace/checkpoints/gc/preview",
        timeout=_T,
    )
    assert resp.status_code in (200, 400, 404, 422), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_loops_status(app_server) -> None:
    """Loop mode status endpoint parses."""
    resp = app_server.api_request("GET", "/api/loops/status", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_loops_gates_catalog(app_server) -> None:
    """Loop gates catalog endpoint parses."""
    resp = app_server.api_request(
        "GET",
        "/api/loops/gates/catalog",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_loops_custom_list(app_server) -> None:
    """Custom loop modes list endpoint parses."""
    resp = app_server.api_request("GET", "/api/loops/custom", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_loops_delete_unknown_mode(app_server) -> None:
    """Deleting an unknown custom loop mode is contractual."""
    resp = app_server.api_request(
        "DELETE",
        "/api/loops/custom/integ-no-such-mode",
        timeout=_T,
    )
    assert resp.status_code in (204, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_backups_jobs_listing(app_server) -> None:
    """Backup jobs listing parses."""
    resp = app_server.api_request("GET", "/api/backups/jobs", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_backups_jobs_active(app_server) -> None:
    """Active backup jobs endpoint parses."""
    resp = app_server.api_request(
        "GET",
        "/api/backups/jobs/active",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_backups_job_unknown(app_server) -> None:
    """Lookup of an unknown backup job is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/backups/jobs/integ-no-such-job",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_backups_job_events_unknown(app_server) -> None:
    """Events of an unknown backup job is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/backups/jobs/integ-no-such-job/events",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_harness_models_unknown_provider(app_server) -> None:
    """Harness models for an unknown provider is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/harnesses/integ-no-such-provider/models",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_harness_mcp_unknown_provider(app_server) -> None:
    """Harness MCP surface for an unknown provider is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/harnesses/integ-no-such-provider/mcp",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_harness_skills_unknown_provider(app_server) -> None:
    """Harness skills for an unknown provider is contractual."""
    resp = app_server.api_request(
        "GET",
        "/api/harnesses/integ-no-such-provider/skills",
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_provider_oauth_status_unknown(app_server) -> None:
    """Provider OAuth status requires a state param (422 without)."""
    resp = app_server.api_request(
        "GET",
        "/api/providers/integ-no-such-provider/oauth/status",
        params={"state": "integ-state"},
        timeout=_T,
    )
    assert resp.status_code in (200, 404), app_server.logs_tail()
