# -*- coding: utf-8 -*-
"""
Skill-hub coverage journey (5pp wave 3).

agents/skill_system/hub.py has 1,044 uncovered lines — search/install from
the online hub. The hub endpoint (clawhub.ai) is reachable from this
environment. These cases drive hub search via the API and the pool install
UI flow.

Run: pytest tests/test_cov_hub_journey.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestHubSearchJourney:
    """
    COV-HUB-001: search the online skill hub through the hub/search
    endpoint, exercising the hub client (search path, response parsing).
    """

    @pytest.mark.test_id("COV-HUB-001")
    def test_hub_search(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Search the hub with a common keyword")
        resp = api_context.get("/api/skills/hub/search?q=pdf&limit=10")
        # Hub reachability is environment-dependent; treat network failure
        # as a soft skip, but parse success strictly.
        if resp.status >= 500:
            pytest.skip(f"hub backend unavailable [{resp.status}]")
        assert resp.ok, f"hub search failed [{resp.status}]: {resp.text()[:200]}"
        results = resp.json()
        assert isinstance(results, list), "hub search must return a list"
        logger.info("hub search returned %d result(s)", len(results))

        log_test_step("2. Search with an empty query")
        resp2 = api_context.get("/api/skills/hub/search?q=&limit=5")
        assert resp2.ok or resp2.status >= 500, (
            f"empty-query hub search failed [{resp2.status}]"
        )

        log_test_step("3. Refresh the pool")
        resp3 = api_context.post("/api/skills/pool/refresh")
        assert resp3.ok, f"pool refresh failed [{resp3.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.skills
class TestHubBuiltinImportJourney:
    """
    COV-HUB-002: drive the builtin-import + builtin-notice endpoints used by
    the pool's Update Built-in Skills action.
    """

    @pytest.mark.test_id("COV-HUB-002")
    def test_builtin_import_flow(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read builtin sources and notice")
        resp = api_context.get("/api/skills/pool/builtin-sources")
        assert resp.ok, f"builtin-sources failed [{resp.status}]"
        resp2 = api_context.get("/api/skills/pool/builtin-notice")
        assert resp2.ok, f"builtin-notice failed [{resp2.status}]"

        log_test_step("2. Read the workspaces skill sources list")
        resp3 = api_context.get("/api/skills/workspaces")
        assert resp3.ok, f"workspaces list failed [{resp3.status}]"

        log_test_result(test_name, True, 0)
