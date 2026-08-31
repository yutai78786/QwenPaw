# -*- coding: utf-8 -*-
"""
Context & scroll deep coverage (5pp wave).

Targets context/scroll/* (manager.py 587 + memoryspace.py 802 +
recall_tool.py 326 uncovered lines) by driving the agent to actually use
its recall/compression machinery through the chat UI.

Run: pytest tests/test_cov_context_deep.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

logger = logging.getLogger(__name__)


def _wait_reply_grows(page, before_count: int, timeout_ms: int = 90000) -> bool:
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
@pytest.mark.requires_llm
@pytest.mark.chat
class TestRecallHistoryJourney:
    """
    COV-CTX-002: make the agent exercise its history-recall machinery.
    Exercises context/scroll/recall_tool.py + memoryspace.py (search over
    conversation history) and the scroll manager.
    """

    @pytest.mark.test_id("COV-CTX-002")
    def test_recall_history_journey(
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

        # ---- Seed a few memorable turns so history has content ----
        seeds = [
            "Remember this fact for later: the E2E marker word is 'lighthouse-42'.",
            "Another fact to remember: the second marker is 'harbor-7'.",
        ]
        for s in seeds:
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(s)
            assert _wait_reply_grows(page, before), f"no reply to seed: {s[:20]}"

        # ---- Ask the agent to search its own history ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Search your conversation history for the word 'lighthouse' and "
            "tell me the full sentence you find."
        )
        assert _wait_reply_grows(page, before, timeout_ms=120000), (
            "no reply to recall search round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestLongConversationCompaction:
    """
    COV-CTX-003: build a longer multi-turn conversation then trigger
    /compact, exercising the scroll manager compress path with real
    history to fold.
    """

    @pytest.mark.test_id("COV-CTX-003")
    def test_long_conversation_compact(
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

        # ---- Build up several turns ----
        turns = [
            "List three primary colors, one per line.",
            "Now list two oceans.",
            "What is the capital of Japan? Answer in one short sentence.",
            "Give me a one-line summary of photosynthesis.",
        ]
        for t in turns:
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(t)
            assert _wait_reply_grows(page, before), f"no reply to turn: {t[:20]}"

        # ---- Trigger compaction ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("/compact")
        page.wait_for_timeout(10000)
        # session must stay healthy
        assert page.locator("textarea").first.count() > 0, (
            "chat input vanished after /compact"
        )

        # ---- Confirm session still works post-compaction ----
        after = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("One final question: name a mammal that lives in the sea.")
        assert _wait_reply_grows(page, after), "no reply after compaction"

        logger.info("Test %s passed", test_name)
