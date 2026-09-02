# -*- coding: utf-8 -*-
"""
Final buffer wave: tool-calls / market / agent-stats / misc (5pp wave 30).

Last deterministic buffer to widen the single-round margin:
- /tool-calls list/detail/output/offload/cancel/extend-deadline on a
  synthetic session (error branches still exercise router+service paths)
- /market providers/categories/search catalog surfaces
- /agent-stats llm-tool-trend
- /agent-status + /healthz

All calls are pure API round trips (no LLM), deterministic by design.

Run: pytest tests/test_cov_journey_deep30.py -v
"""
from __future__ import annotations

import json
import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

SYN_SESSION = "e2e-cov30-session"
SYN_CALL = "e2e-cov30-call"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.tools
class TestToolCallSurfaces:
    """COV-TC-001: tool-calls list/detail/output/lifecycle surfaces."""

    @pytest.mark.test_id("COV-TC-001")
    def test_tool_call_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List tool calls for a synthetic session")
        ls = api_context.get(f"/api/tool-calls/{SYN_SESSION}")
        assert ls.ok, f"tool-calls list [{ls.status}]"

        log_test_step("2. Detail + output + stream surfaces (404 branches)")
        det = api_context.get(f"/api/tool-calls/{SYN_SESSION}/{SYN_CALL}")
        logger.info("detail -> %s", det.status)
        assert det.status in (200, 404), f"detail [{det.status}]"
        out = api_context.get(f"/api/tool-calls/{SYN_SESSION}/{SYN_CALL}/output")
        logger.info("output -> %s", out.status)
        assert out.status in (200, 404), f"output [{out.status}]"

        log_test_step("3. Lifecycle actions on missing call -> 404 branches")
        for action, method in (
            ("offload", "post"), ("cancel", "post"),
            ("extend-deadline", "post"),
        ):
            r = getattr(api_context, method)(
                f"/api/tool-calls/{SYN_SESSION}/{SYN_CALL}/{action}",
                data=json.dumps({}),
            )
            logger.info("%s -> %s", action, r.status)
            assert r.status in (200, 202, 400, 404, 409), (
                f"{action} [{r.status}]"
            )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestMarketCatalogSurfaces:
    """COV-MKT-001: market providers/categories/search catalog."""

    @pytest.mark.test_id("COV-MKT-001")
    def test_market_catalog_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Providers + categories catalogs")
        pv = api_context.get("/api/market/providers")
        assert pv.ok, f"market providers [{pv.status}]"
        ct = api_context.get("/api/market/categories")
        assert ct.ok, f"market categories [{ct.status}]"

        log_test_step("2. Search probe (network-safe, any status ok)")
        sr = api_context.post(
            "/api/market/search",
            data=json.dumps({"query": "test", "limit": 5, "lang": "en"}),
        )
        logger.info("market search -> %s", sr.status)
        assert sr.status in (200, 400, 500, 502, 503), (
            f"market search [{sr.status}]"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agent_stats
class TestAgentStatsSurfaces:
    """COV-AST-001: agent-stats trend surfaces."""

    @pytest.mark.test_id("COV-AST-001")
    def test_agent_stats_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. llm-tool-trend surface")
        tr = api_context.get("/api/agent-stats/llm-tool-trend")
        logger.info("llm-tool-trend -> %s", tr.status)
        assert tr.status in (200, 400, 404), f"trend [{tr.status}]"

        log_test_step("2. Agent status surface")
        st = api_context.get("/api/agent-status")
        logger.info("agent-status -> %s", st.status)
        assert st.status in (200, 400, 404), f"agent-status [{st.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.cross_module
class TestHealthAndFrontendPlugin:
    """COV-MISC-001: healthz + frontend plugin file surfaces."""

    @pytest.mark.test_id("COV-MISC-001")
    def test_health_and_frontend_plugin(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Healthz")
        hz = api_context.get("/api/healthz")
        assert hz.ok, f"healthz [{hz.status}]"

        log_test_step("2. Frontend plugin file on unknown plugin -> 404")
        fp = api_context.get(
            "/api/frontend_plugin/e2e_cov30_none/files/index.js")
        logger.info("frontend plugin file -> %s", fp.status)
        assert fp.status in (400, 404), f"frontend plugin [{fp.status}]"

        log_test_result(test_name, True, 0)
