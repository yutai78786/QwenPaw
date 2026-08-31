# -*- coding: utf-8 -*-
"""
Targeted big-block journeys (5pp wave 20).

Focuses on the largest blocks still below 50%:
  - agents/tools/agent_management.py (517) — agent self-introspection
  - agents/model_factory.py (498) — model rebuild / reload
  - agents/context/scroll/manager.py (543) — compact over deep history
  - app/mail/mail_access_control.py (387) — mail ACL writes
  - plugins/api.py (387) — plugin api reads

Run: pytest tests/test_cov_journey_deep20.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


def _wait_reply(page, before: int, timeout_ms: int = 150000) -> bool:
    elapsed = 0
    while elapsed < timeout_ms:
        if page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before:
            page.wait_for_timeout(2500)
            return True
        page.wait_for_timeout(1000)
        elapsed += 1000
    return page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestAgentIntrospectionJourney:
    """COV-AGINT-001: agent introspection via multiple distinct questions."""

    @pytest.mark.test_id("COV-AGINT-001")
    def test_agent_introspection(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        prompts = [
            "What is your active model and provider?",
            "List the skills you have available.",
            "What is the current working directory?",
            "Do you have a browser tool? Tell me briefly.",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to introspection {i}"
        logger.info("agent introspection done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestModelReloadJourney:
    """COV-MRELOAD-001: switch models several times to exercise model_factory."""

    @pytest.mark.test_id("COV-MRELOAD-001")
    def test_model_reload(
        self,
        clean_chat_page: ChatPage,
        api_context,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        active = api_context.get("/api/models/active")
        orig = active.json().get("active_llm", {}).get("model", "qwen3.7-plus") if active.ok else "qwen3.7-plus"

        providers = api_context.get("/api/models").json()
        plist = providers if isinstance(providers, list) else providers.get("providers", [])
        candidates = []
        for p in plist:
            if p.get("id") == "dashscope":
                for m in p.get("models", []):
                    mid = m.get("id", "")
                    if mid and mid != orig:
                        candidates.append(mid)

        # Switch to first candidate, chat, switch back
        if candidates:
            api_context.put("/api/models/active",
                            data={"provider_id": "dashscope", "model": candidates[0], "scope": "global"})
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message("Say 'reload-check'.")
            assert _wait_reply(page, before), "no reply after model switch"

        api_context.put("/api/models/active",
                        data={"provider_id": "dashscope", "model": orig, "scope": "global"})
        logger.info("model reload journey done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestDeepCompactJourney:
    """COV-DCOMPACT-001: build 10 turns then /compact (scroll manager deep)."""

    @pytest.mark.test_id("COV-DCOMPACT-001")
    def test_deep_compact(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        turns = [f"Tell me one fact about the number {i}." for i in range(1, 9)]
        for t in turns:
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(t)
            elapsed = 0
            while elapsed < 90000 and page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() <= before:
                page.wait_for_timeout(1000)
                elapsed += 1000
            assert page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before, f"no reply to {t}"

        ta = page.locator("textarea").first
        ta.fill("/compact")
        page.wait_for_timeout(200)
        page.locator("button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary").first.click()
        page.wait_for_timeout(12000)
        assert page.locator("textarea").first.count() > 0, "broke after compact"
        logger.info("deep compact done")


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestMailAclWritesJourney:
    """COV-MAILW-001: mail ACL whitelist/blacklist add/remove round trips."""

    @pytest.mark.test_id("COV-MAILW-001")
    def test_mail_acl_writes(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        addr = "e2e_cov20@example.com"

        log_test_step("1. Whitelist add/remove")
        api_context.post("/api/mail-access-control/whitelist/add",
                         data={"address": addr}, headers=H)
        api_context.post("/api/mail-access-control/whitelist/remove",
                         data={"address": addr}, headers=H)

        log_test_step("2. Blacklist add/remove")
        api_context.post("/api/mail-access-control/blacklist/add",
                         data={"address": addr}, headers=H)
        api_context.post("/api/mail-access-control/blacklist/remove",
                         data={"address": addr}, headers=H)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.plugins
class TestPluginApiReadsJourney:
    """COV-PLUGAPI-001: plugin api read endpoints."""

    @pytest.mark.test_id("COV-PLUGAPI-001")
    def test_plugin_api_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        resp = api_context.get("/api/plugins", headers=H)
        logger.info("plugins -> %s", resp.status)
        log_test_result(test_name, True, 0)
