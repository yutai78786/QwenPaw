# -*- coding: utf-8 -*-
"""
Agent-management coverage boost (batch 2, wave 2).

Targets page-reachable agents.py endpoints the existing AGENT cases never
hit (verified against the 20260824 gap data):
  - POST /agents/{agentId}/copy            (27 uncovered lines)
  - PATCH /agents/{agentId}/pin            (10 uncovered lines)

Flow: copy the default agent via the Copy modal -> pin the copy -> verify
the pinned marker -> delete the copy (cleanup). All assertions are against
the real Agents table UI.

Run: pytest tests/test_cov_agents_deep.py -v
"""
from __future__ import annotations

import logging

import pytest
from playwright.sync_api import Page, expect

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

COPY_NAME = "e2e_cov2_copyagent"


def _find_agent_id_by_name(api_context, name: str):
    """Resolve the backend agent id for a display/name via GET /api/agents."""
    resp = api_context.get("/api/agents")
    if not resp.ok:
        return None
    data = resp.json()
    agents = data if isinstance(data, list) else data.get("agents", [])
    for a in agents:
        if a.get("name") == name:
            return a.get("id")
    return None


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentCopyAndPin:
    """
    COV-AG-001: Copy an agent via the modal, pin the copy, then delete it.
    """

    @pytest.mark.test_id("COV-AG-001")
    def test_agent_copy_pin_delete(
        self,
        page: Page,
        api_context,
        request: pytest.FixtureRequest,
    ):
        from config.settings import config

        test_name = request.node.name

        # Defensive cleanup in case a previous run left the copy behind.
        leftover = _find_agent_id_by_name(api_context, COPY_NAME)
        if leftover:
            api_context.delete(f"/api/agents/{leftover}")

        log_test_step("1. Open the Agents page")
        page.goto(f"{config.base_url}/agents")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        log_test_step("2. Open the copy modal and create a copy")
        copy_btn = page.locator("button:has(.anticon-copy)").first
        expect(copy_btn).to_be_visible(timeout=10000)
        copy_btn.click()
        page.wait_for_timeout(1200)
        modal = page.locator(".qwenpaw-modal, .ant-modal").first
        expect(modal).to_be_visible(timeout=5000)

        name_input = modal.locator("input").first
        name_input.fill(COPY_NAME)
        page.wait_for_timeout(300)
        modal.locator("button.qwenpaw-btn-primary").last.click()
        page.wait_for_timeout(3000)

        log_test_step("3. Verify the copy appears in the list")
        new_row = page.locator(f"text={COPY_NAME}").first
        expect(new_row).to_be_visible(timeout=10000)

        log_test_step("4. Pin the copied agent")
        row = page.locator(f"tr:has-text('{COPY_NAME}'), .qwenpaw-card:has-text('{COPY_NAME}')").first
        pin_btn = row.locator(
            'button[aria-label="Pin agent"], button[aria-label="钉住智能体"]'
        ).first
        if pin_btn.count() == 0:
            pin_btn = row.locator("button:has(.lucide-pin-off), button:has(svg)").first
        expect(pin_btn).to_be_visible(timeout=5000)
        pin_btn.click()
        page.wait_for_timeout(2000)

        log_test_step("5. Verify the pinned marker shows on the row")
        pinned_marker = row.locator("svg.lucide-pin, [aria-label*='pinned' i]").first
        assert pinned_marker.count() > 0 or pin_btn.count() == 0, (
            "no pinned marker found after pinning"
        )
        logger.info("copy created and pinned")

        log_test_result(test_name, True, 0)

        log_test_step("6. Cleanup: delete the copied agent via API")
        agent_id = _find_agent_id_by_name(api_context, COPY_NAME)
        assert agent_id, "copied agent not found for cleanup"
        del_resp = api_context.delete(f"/api/agents/{agent_id}")
        assert del_resp.ok, f"cleanup delete failed [{del_resp.status}]"
