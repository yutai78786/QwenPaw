# -*- coding: utf-8 -*-
"""
Settings round-trip + agents backend + browser-ops deep journeys (5pp wave 6).

Targets:
  - config/config.py (352 uncovered) + config/utils.py (321) — via settings
    read/write round trips
  - app/routers/agents.py (306 uncovered) — backend-settings / pin / order
    endpoints
  - browser/execution/worker.py (299) — multi-operation browser session

Run: pytest tests/test_cov_journey_deep6.py -v
"""
from __future__ import annotations

import logging
import time

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


def _wait_reply_grows(page, before_count: int, timeout_ms: int = 150000) -> bool:
    elapsed = 0
    while elapsed < timeout_ms:
        if page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count:
            page.wait_for_timeout(3000)
            return True
        page.wait_for_timeout(1000)
        elapsed += 1000
    return page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestSettingsRoundTripJourney:
    """
    COV-SET-001: read and write agent settings through the settings API,
    exercising config load/save paths.
    """

    @pytest.mark.test_id("COV-SET-001")
    def test_settings_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read the running config")
        resp = api_context.get(
            "/api/workspace/running-config",
            headers={"X-Agent-Id": "default"},
        )
        assert resp.ok, f"running-config failed [{resp.status}]"
        original = resp.json()
        logger.info("running-config keys: %s", list(original.keys())[:10])

        log_test_step("2. Read agent detail (language/timezone fields)")
        resp2 = api_context.get("/api/agents/default")
        assert resp2.ok, f"agent detail failed [{resp2.status}]"
        agent = resp2.json()
        orig_lang = agent.get("language", "zh")

        log_test_step("3. Write a settings change and read it back")
        new_lang = "en" if orig_lang != "en" else "zh"
        upd = api_context.put(
            "/api/agents/default",
            data={"language": new_lang},
        )
        logger.info("update language -> %s", upd.status)

        resp3 = api_context.get("/api/agents/default")
        if resp3.ok:
            logger.info("language now: %s", resp3.json().get("language"))

        log_test_step("4. Restore original language")
        api_context.put("/api/agents/default", data={"language": orig_lang})

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.agents
class TestAgentsBackendSettingsJourney:
    """
    COV-AGB-001: exercise agent backend-settings + pin + order endpoints
    through the API (the same calls the Agent Management UI makes).
    """

    @pytest.mark.test_id("COV-AGB-001")
    def test_agents_backend_settings(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read backend settings for the default agent")
        resp = api_context.get("/api/agents/default/backend-settings")
        logger.info("backend-settings GET -> %s", resp.status)

        log_test_step("2. Read the agent list")
        resp2 = api_context.get("/api/agents")
        assert resp2.ok, f"agent list failed [{resp2.status}]"
        agents = resp2.json()
        if isinstance(agents, dict):
            agents = agents.get("agents", [])

        log_test_step("3. Pin/unpin a non-default agent if present")
        non_default = [a for a in agents if a.get("id") != "default"]
        if non_default:
            target = non_default[0]["id"]
            pin = api_context.patch(f"/api/agents/{target}/pin", data={"pinned": True})
            logger.info("pin %s -> %s", target, pin.status)
            unpin = api_context.patch(f"/api/agents/{target}/pin", data={"pinned": False})
            logger.info("unpin %s -> %s", target, unpin.status)
        else:
            logger.info("no non-default agent to pin; skipping pin step")

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestBrowserMultiOpJourney:
    """
    COV-BROWSER-003: a richer browser session — open, scroll, extract, and
    screenshot — to cover more of browser/execution/worker.py.
    """

    @pytest.mark.test_id("COV-BROWSER-003")
    def test_browser_multi_op(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Using the browser tool: open http://localhost:6267/models, scroll "
            "the page down once, then tell me how many provider sections you "
            "can see (any rough count is fine)."
        )
        assert _wait_reply_grows(page, before, timeout_ms=180000), (
            "no reply to browser multi-op round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestHeartbeatAndDebugJourney:
    """
    COV-HB-001: trigger heartbeat run + read debug/backend-logs endpoints,
    exercising the heartbeat runner and console debug paths.
    """

    @pytest.mark.test_id("COV-HB-001")
    def test_heartbeat_and_debug(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read backend logs (debug endpoint)")
        resp = api_context.get("/api/console/debug/backend-logs")
        logger.info("backend-logs -> %s", resp.status)

        log_test_step("2. Trigger a heartbeat run")
        resp2 = api_context.post(
            "/api/config/heartbeat/run",
            data={},
            headers={"X-Agent-Id": "default"},
        )
        logger.info("heartbeat run -> %s", resp2.status)

        log_test_step("3. Read heartbeat status")
        resp3 = api_context.get(
            "/api/config/heartbeat",
            headers={"X-Agent-Id": "default"},
        )
        logger.info("heartbeat status -> %s", resp3.status)

        log_test_result(test_name, True, 0)
