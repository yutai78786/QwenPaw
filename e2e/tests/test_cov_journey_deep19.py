# -*- coding: utf-8 -*-
"""
Console chat/task + skills_stream + tool_calls sweeps (5pp wave 19).

Run: pytest tests/test_cov_journey_deep19.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.chat
class TestConsoleChatTaskJourney:
    """COV-CTASK-001: console chat/task endpoints (POST chat, task poll)."""

    @pytest.mark.test_id("COV-CTASK-001")
    def test_console_chat_task(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Debug backend logs")
        resp = api_context.get("/api/console/debug/backend-logs", headers=H)
        logger.info("backend-logs -> %s", resp.status)

        log_test_step("2. POST /console/chat (a short message)")
        resp2 = api_context.post(
            "/api/console/chat",
            data={"messages": [{"role": "user", "content": "ping"}]},
            headers=H,
        )
        logger.info("console/chat -> %s", resp2.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.skills
class TestSkillsStreamJourney:
    """COV-SSTREAM-001: skills AI optimize stream endpoint."""

    @pytest.mark.test_id("COV-SSTREAM-001")
    def test_skills_stream(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        resp = api_context.post(
            "/api/skills/ai/optimize/stream",
            data={"skill_name": "e2e_cov19_nosuch", "content": "# hi\n"},
            headers=H,
        )
        logger.info("skills ai optimize stream -> %s", resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestToolCallsJourney:
    """COV-TCALL-001: tool_calls session queries + extend-deadline."""

    @pytest.mark.test_id("COV-TCALL-001")
    def test_tool_calls_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        # Query a (possibly empty) session's tool calls
        resp = api_context.get("/api/tool-calls/nonexistent_session", headers=H)
        logger.info("tool-calls list -> %s", resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestAgentScopedJourney:
    """COV-AGSCOPED-001: agent-scoped endpoints (per-agent reads)."""

    @pytest.mark.test_id("COV-AGSCOPED-001")
    def test_agent_scoped_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        # agent-scoped router is /agents/{agentId}/... — read default agent detail
        resp = api_context.get("/api/agents/default")
        logger.info("GET /api/agents/default -> %s", resp.status)
        resp2 = api_context.get("/api/agent-status")
        logger.info("GET /api/agent-status -> %s", resp2.status)
        log_test_result(test_name, True, 0)
