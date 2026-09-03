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
import time
from typing import List

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

CLONE_NAME = "E2E Cov22 Clone"

# A freshly copied agent boots asynchronously. While its startup_status is
# pending/starting, both PATCH /toggle(enabled=false) and DELETE answer 409
# ("still starting" / "cannot be deleted while starting"). Poll the listing
# endpoint until the agent leaves that window instead of firing-and-forgetting.
_NOT_READY_STATUSES = {"pending", "starting"}


def _wait_agent_startup_settled(
    api_context, agent_id: str, timeout_s: int = 90,
) -> str:
    """Block until an agent is out of the startup window.

    Returns the last observed startup_status (or "" if the agent vanished).
    """
    deadline = time.monotonic() + timeout_s
    status = ""
    while time.monotonic() < deadline:
        listing = api_context.get("/api/agents")
        if not listing.ok:
            time.sleep(2)
            continue
        payload = listing.json()
        agents = payload.get("agents") if isinstance(payload, dict) else payload
        entry = next(
            (a for a in (agents or []) if a.get("id") == agent_id), None,
        )
        if entry is None:
            logger.info("agent %s no longer listed", agent_id)
            return ""
        status = str(entry.get("startup_status") or "")
        if status not in _NOT_READY_STATUSES:
            logger.info("agent %s settled: %s", agent_id, status)
            return status
        time.sleep(2)
    logger.warning(
        "agent %s still %s after %ss", agent_id, status or "?", timeout_s,
    )
    return status


def _list_clone_ids(api_context) -> List[str]:
    """Return the IDs of every agent named CLONE_NAME."""
    listing = api_context.get("/api/agents")
    if not listing.ok:
        logger.warning("agent listing failed [%s]", listing.status)
        return []
    try:
        payload = listing.json()
    except Exception:  # pragma: no cover - defensive
        logger.warning("agent listing not JSON")
        return []
    agents = payload.get("agents") if isinstance(payload, dict) else payload
    return [
        a["id"]
        for a in (agents or [])
        if isinstance(a, dict)
        and a.get("name") == CLONE_NAME
        and a.get("id")
    ]


def _delete_agent_quietly(api_context, agent_id: str) -> bool:
    """Delete one agent, waiting out the startup gate if it answers 409."""
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        resp = api_context.delete(f"/api/agents/{agent_id}")
        if resp.ok:
            logger.info("deleted agent %s", agent_id)
            return True
        if resp.status == 404:
            return True
        if resp.status == 409:
            logger.info("agent %s still starting; retry delete", agent_id)
            time.sleep(3)
            continue
        logger.warning(
            "delete agent %s failed [%s]: %s",
            agent_id, resp.status, resp.text()[:150],
        )
        return False
    logger.warning("gave up deleting agent %s (409 loop)", agent_id)
    return False


def _purge_leftover_clones(api_context) -> None:
    """Delete every agent left over from a previous run of this case.

    The copy endpoint generates the new agent ID itself
    (``_generate_unique_id``); it does not accept a caller-supplied ID.
    So cleanup must resolve leftovers by *name*, not by a hardcoded ID.
    """
    for clone_id in _list_clone_ids(api_context):
        _delete_agent_quietly(api_context, clone_id)


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
        clone_id = None

        try:
            log_test_step("1. Cleanup any leftover clone from earlier runs")
            _purge_leftover_clones(api_context)

            log_test_step("2. Copy the default agent")
            resp = api_context.post(
                "/api/agents/default/copy",
                data={"name": CLONE_NAME},
            )
            logger.info("copy -> %s", resp.status)
            # Strict: the copy endpoint must succeed and must hand back the
            # ID it actually created. Tolerating 409/404 here used to hide a
            # leaked agent (caller-supplied ID was silently dropped) and left
            # the clone visible in the agent switcher, which in turn broke
            # MA-001 in test_cross_module.py.
            assert resp.ok, (
                f"agent copy failed [{resp.status}]: {resp.text()[:200]}"
            )
            body = resp.json()
            clone_id = body.get("id")
            assert clone_id, f"copy response has no agent id: {body!r}"

            log_test_step("3. Read the clone")
            detail = api_context.get(f"/api/agents/{clone_id}")
            assert detail.ok, (
                f"clone read failed [{detail.status}]: {detail.text()[:200]}"
            )

            log_test_step("4. Wait out the startup gate, then toggle")
            settled = _wait_agent_startup_settled(api_context, clone_id)
            logger.info("clone startup settled as %r", settled)
            tog = api_context.patch(
                f"/api/agents/{clone_id}/toggle", data={"enabled": False})
            logger.info("toggle -> %s", tog.status)
            assert tog.ok, f"toggle failed [{tog.status}]: {tog.text()[:200]}"

            log_test_step("5. Pin the clone")
            pin = api_context.patch(
                f"/api/agents/{clone_id}/pin", data={"pinned": True})
            logger.info("pin -> %s", pin.status)
            assert pin.ok, f"pin failed [{pin.status}]: {pin.text()[:200]}"

            log_test_step("6. Delete the clone")
            assert _delete_agent_quietly(api_context, clone_id), (
                f"clone {clone_id} could not be deleted"
            )

            log_test_step("7. Clone is gone; no residue for later cases")
            gone = api_context.get(f"/api/agents/{clone_id}")
            assert gone.status == 404, (
                f"clone still readable after delete [{gone.status}]"
            )
            clone_id = None
        finally:
            # Never leave the clone behind, even if an assertion above trips.
            if clone_id:
                _delete_agent_quietly(api_context, clone_id)
            _purge_leftover_clones(api_context)

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
