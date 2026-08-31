# -*- coding: utf-8 -*-
"""
Diverse deep journeys (5pp wave 17).

More journey diversity to accumulate coverage across the long tail of small
files (channels/base stream, approvals service, tool_calls coordinator,
runtime hooks, context assembly).

Run: pytest tests/test_cov_journey_deep17.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

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
class TestWebSearchJourney:
    """COV-WEB-001: web_search tool via chat."""

    @pytest.mark.test_id("COV-WEB-001")
    def test_web_search(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "If you have a web_search tool, use it to look up 'QwenPaw agent "
            "framework' and tell me one thing you find. If web search is "
            "unavailable, just say so."
        )
        assert _wait_reply(page, before), "no reply to web search"
        logger.info("web search journey done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestPlanningJourney:
    """COV-PLAN-001: /plan command + a planning-style request."""

    @pytest.mark.test_id("COV-PLAN-001")
    def test_planning(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # Bare /plan is a status command
        ta = page.locator("textarea").first
        ta.fill("/plan")
        page.wait_for_timeout(200)
        page.locator("button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary").first.click()
        page.wait_for_timeout(8000)
        assert page.locator("textarea").first.count() > 0, "session broke on /plan"

        # A planning request
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Give me a 3-step plan to organize a small team meeting. Keep it short."
        )
        assert _wait_reply(page, before), "no reply to planning request"
        logger.info("planning journey done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestMultimodalHintJourney:
    """COV-MM-001: ask about image handling to engage provider capability paths."""

    @pytest.mark.test_id("COV-MM-001")
    def test_multimodal_hint(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Can you process images? Describe what image formats you support."
        )
        assert _wait_reply(page, before), "no reply to multimodal hint"
        logger.info("multimodal hint journey done")


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestSummarizeStatusJourney:
    """COV-SUMSTAT-001: /summarize_status command."""

    @pytest.mark.test_id("COV-SUMSTAT-001")
    def test_summarize_status(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # Seed a couple turns first
        for msg in ["Hello there.", "How are you?"]:
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(msg)
            assert _wait_reply(page, before), f"no reply to {msg}"

        ta = page.locator("textarea").first
        ta.fill("/summarize_status")
        page.wait_for_timeout(200)
        page.locator("button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary").first.click()
        page.wait_for_timeout(8000)
        assert page.locator("textarea").first.count() > 0, (
            "session broke on /summarize_status"
        )
        logger.info("summarize_status journey done")
