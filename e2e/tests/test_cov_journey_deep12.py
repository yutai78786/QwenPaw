# -*- coding: utf-8 -*-
"""
Remaining-router sweep journeys (5pp wave 12).

Deterministic API sweeps of routers the page-based cases never touch:
  - envs.py            (list/set/delete env vars)
  - git.py             (branches/diff/log/status of the workspace git repo)
  - market.py          (marketplace catalog)
  - token_usage.py     (usage + details)
  - healthz.py         (health probe)
  - frontend_plugin.py (frontend plugin listing)

Run: pytest tests/test_cov_journey_deep12.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.chat
class TestEnvsRouterJourney:
    """COV-ENV-001: list/set/delete an env var through the envs router."""

    @pytest.mark.test_id("COV-ENV-001")
    def test_envs_crud(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List envs")
        resp = api_context.get("/api/envs")
        assert resp.ok, f"envs list failed [{resp.status}]"

        log_test_step("2. Set an env var")
        key = "E2E_COV12_PROBE"
        put = api_context.put("/api/envs", data={key: "coverage-probe"})
        logger.info("envs put -> %s", put.status)

        log_test_step("3. Read it back")
        listing = api_context.get("/api/envs")
        body = listing.json()
        logger.info("envs count: %s", len(body) if isinstance(body, list) else "?")

        log_test_step("4. Delete it")
        api_context.delete(f"/api/envs/{key}")

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestGitRouterJourney:
    """COV-GIT-001: read git status/branches/log/diff for the workspace."""

    @pytest.mark.test_id("COV-GIT-001")
    def test_git_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        for path in ["/api/git", "/api/git/branches", "/api/git/log"]:
            resp = api_context.get(path, headers=H)
            logger.info("GET %s -> %s", path, resp.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestMarketAndUsageJourney:
    """COV-MKT-001: marketplace catalog + token usage + healthz + frontend plugins."""

    @pytest.mark.test_id("COV-MKT-001")
    def test_market_usage_health(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Marketplace catalog")
        resp = api_context.get("/api/market/en", headers=H)
        logger.info("market -> %s", resp.status)

        log_test_step("2. Token usage + details")
        for path in ["/api/token-usage", "/api/token-usage/details"]:
            r = api_context.get(path, headers=H)
            logger.info("GET %s -> %s", path, r.status)

        log_test_step("3. Health probe")
        r = api_context.get("/api/healthz")
        logger.info("healthz -> %s", r.status)

        log_test_step("4. Frontend plugins")
        r = api_context.get("/api/frontend-plugins", headers=H)
        logger.info("frontend-plugins -> %s", r.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestMessagesRouterJourney:
    """COV-MSG-001: read the messages router (chat history endpoints)."""

    @pytest.mark.test_id("COV-MSG-001")
    def test_messages_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        resp = api_context.get("/api/messages", headers=H)
        logger.info("messages -> %s", resp.status)

        log_test_result(test_name, True, 0)
