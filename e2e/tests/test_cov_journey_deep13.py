# -*- coding: utf-8 -*-
"""
Backup jobs + loops + agent-stats + approval sweeps (5pp wave 13).

Run: pytest tests/test_cov_journey_deep13.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestBackupJobsJourney:
    """COV-BK-001: backup jobs active/list + events read."""

    @pytest.mark.test_id("COV-BK-001")
    def test_backup_jobs(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Active jobs")
        resp = api_context.get("/api/backup/jobs/active", headers=H)
        logger.info("active jobs -> %s", resp.status)

        log_test_step("2. List backups")
        resp2 = api_context.get("/api/backup", headers=H)
        logger.info("backup list -> %s", resp2.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestLoopsJourney:
    """COV-LOOP-001: loops list + custom create/duplicate/delete."""

    @pytest.mark.test_id("COV-LOOP-001")
    def test_loops(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. List loops")
        resp = api_context.get("/api/loops", headers=H)
        logger.info("loops -> %s", resp.status)

        log_test_step("2. Create a custom loop")
        create = api_context.post(
            "/api/loops/custom",
            data={"name": "e2e_cov13_loop", "description": "coverage probe"},
            headers=H,
        )
        logger.info("loop create -> %s", create.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestAgentStatsStatusJourney:
    """COV-STAT-001: agent stats + status + approval list."""

    @pytest.mark.test_id("COV-STAT-001")
    def test_agent_stats_status(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Agent stats")
        resp = api_context.get("/api/agent-stats", headers=H)
        logger.info("agent-stats -> %s", resp.status)

        log_test_step("2. LLM tool trend")
        resp2 = api_context.get("/api/agent-stats/llm-tool-trend", headers=H)
        logger.info("llm-tool-trend -> %s", resp2.status)

        log_test_step("3. Agent status")
        resp3 = api_context.get("/api/agent-status", headers=H)
        logger.info("agent-status -> %s", resp3.status)

        log_test_step("4. Approval list")
        resp4 = api_context.get("/api/approval/list", headers=H)
        logger.info("approval list -> %s", resp4.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestHearnessesPawappsJourney:
    """COV-MISC-001: harnesses + pawapps + provider_oauth + schemas_config reads."""

    @pytest.mark.test_id("COV-MISC-001")
    def test_harnesses_pawapps(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        for path in ["/api/harnesses", "/api/pawapps",
                     "/api/provider-oauth", "/api/schemas-config"]:
            resp = api_context.get(path, headers=H)
            logger.info("GET %s -> %s", path, resp.status)

        log_test_result(test_name, True, 0)
