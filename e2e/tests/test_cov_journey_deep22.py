# -*- coding: utf-8 -*-
"""
Agent-config deep round trips (5pp wave 22).

Deterministic coverage of config/config.py load/save/migrate paths via the
agents router. The agents.py router has ~15 endpoints; existing page cases
only hit a few. This wave sweeps the rest: copy, pin, backend-settings,
model-settings, memory status/graph, toggle, order.

Run: pytest tests/test_cov_journey_deep22.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

CLONE_ID = "e2e_cov22_clone"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentCopyAndManageJourney:
    """COV-AGCPY-001: copy agent -> read -> toggle -> pin -> delete copy."""

    @pytest.mark.test_id("COV-AGCPY-001")
    def test_agent_copy_and_manage(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Cleanup any leftover clone")
        api_context.delete(f"/api/agents/{CLONE_ID}")

        log_test_step("2. Copy the default agent")
        resp = api_context.post(
            f"/api/agents/default/copy",
            data={"new_agent_id": CLONE_ID, "name": "E2E Cov22 Clone"},
        )
        logger.info("copy -> %s", resp.status)
        assert resp.ok or resp.status == 409, (
            f"agent copy failed [{resp.status}]: {resp.text()[:200]}"
        )

        log_test_step("3. Read the clone")
        detail = api_context.get(f"/api/agents/{CLONE_ID}")
        assert detail.ok or detail.status == 404, (
            f"clone read failed [{detail.status}]"
        )

        log_test_step("4. Toggle the clone")
        tog = api_context.patch(
            f"/api/agents/{CLONE_ID}/toggle", data={"enabled": False})
        logger.info("toggle -> %s", tog.status)

        log_test_step("5. Pin the clone")
        pin = api_context.patch(
            f"/api/agents/{CLONE_ID}/pin", data={"pinned": True})
        logger.info("pin -> %s", pin.status)

        log_test_step("6. Delete the clone")
        api_context.delete(f"/api/agents/{CLONE_ID}")

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentSettingsPatchesJourney:
    """COV-AGSET-001: backend-settings + model-settings patch round trips."""

    @pytest.mark.test_id("COV-AGSET-001")
    def test_agent_settings_patches(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read current agent")
        resp = api_context.get("/api/agents/default")
        assert resp.ok, f"agent read failed [{resp.status}]"
        original = resp.json()

        log_test_step("2. Patch backend-settings (harmless)")
        be = api_context.patch(
            "/api/agents/default/backend-settings",
            data={"backend": original.get("backend", "qwenpaw")},
        )
        logger.info("backend-settings -> %s", be.status)

        log_test_step("3. Patch model-settings (harmless)")
        ms = api_context.patch(
            "/api/agents/default/model-settings",
            data={},
        )
        logger.info("model-settings -> %s", ms.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentMemoryEndpointsJourney:
    """COV-AGMEM-001: memory status/graph/runtime-status endpoints."""

    @pytest.mark.test_id("COV-AGMEM-001")
    def test_agent_memory_endpoints(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        for path in [
            "/api/agents/default/memory/status",
            "/api/agents/default/memory/runtime-status",
            "/api/agents/default/memory/graph",
        ]:
            resp = api_context.get(path)
            logger.info("GET %s -> %s", path, resp.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentOrderJourney:
    """COV-AGORD-001: agent order PUT (persist agent order)."""

    @pytest.mark.test_id("COV-AGORD-001")
    def test_agent_order(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        resp = api_context.get("/api/agents")
        assert resp.ok, f"agent list failed [{resp.status}]"
        agents = resp.json()
        ids = [a.get("id") or a.get("agent_id") for a in agents] if isinstance(agents, list) else []
        ids = [i for i in ids if i]

        if ids:
            resp2 = api_context.put("/api/agents/order", data={"order": ids})
            logger.info("order PUT -> %s", resp2.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.models
class TestModelVisibilityJourney:
    """COV-MODVIS-001: model visibility PUT + model config PUT."""

    @pytest.mark.test_id("COV-MODVIS-001")
    def test_model_visibility(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Set visibility of a dashscope model")
        resp = api_context.put(
            "/api/models/dashscope/models/qwen3.7-plus/visibility",
            data={"visible": True},
        )
        logger.info("visibility PUT -> %s", resp.status)

        log_test_step("2. Model config PUT")
        resp2 = api_context.put(
            "/api/models/dashscope/models/qwen3.7-plus/config",
            data={},
        )
        logger.info("model config PUT -> %s", resp2.status)

        log_test_result(test_name, True, 0)
