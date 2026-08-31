# -*- coding: utf-8 -*-
"""
Context & Scroll coverage boost (batch 2, wave 2).

Targets the Context & Scroll module — an uncovered area in the 20260824
gap data (context/scroll/manager.py 587 uncovered lines,
context/scroll/memoryspace.py 802 uncovered lines, and
agents/command_handler.py _process_compact 54 lines).

The /compact command delegates to agentscope's native context compression
(command_handler._process_compact -> scroll manager.compress). Two user
paths reach it:
  1. Typing /compact in the chat input box (slash command path).
  2. The context-usage indicator popover's "Compact" button.

Assertion note: /compact is a command-class response and does NOT render a
new assistant bubble (verified in DOM). The meaningful assertions are:
  - the session does not crash,
  - the chat input stays usable, and
  - a follow-up message still receives a reply (compression did not break the
    session).

Why we don't use ChatPage.send_message_and_wait for the slash send: same
reason as test_slash_commands.py — the round-start gate misses fast
command responses. We poll bubbles directly.

Run: pytest tests/test_cov_context_scroll.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

logger = logging.getLogger(__name__)

SEND_BTN = "button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary"
AI_BUBBLE = ".qwenpaw-bubble.qwenpaw-bubble-start"
CTX_INDICATOR = 'button[aria-label*="Context usage"]'


def _wait_bubble_count(page, target: int, timeout_ms: int = 60000) -> bool:
    """Poll until the AI bubble count reaches ``target`` (or timeout)."""
    page.wait_for_timeout(300)
    elapsed = 0
    step = 500
    while elapsed < timeout_ms:
        if page.locator(AI_BUBBLE).count() >= target:
            return True
        page.wait_for_timeout(step)
        elapsed += step
    return page.locator(AI_BUBBLE).count() >= target


def _send_via_input(page, text: str) -> None:
    """Type text into the chat input and press the send button."""
    ta = page.locator("textarea").first
    ta.wait_for(state="visible", timeout=10000)
    ta.fill(text)
    page.wait_for_timeout(200)
    page.locator(SEND_BTN).first.click()


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestContextCompactCommand:
    """
    COV-CTX-001: /compact slash command and the context-usage indicator's
    Compact button both drive context compression without breaking the
    session. Covers command_handler._process_compact and
    context/scroll/manager.compress.
    """

    @pytest.mark.test_id("COV-CTX-001")
    def test_compact_command_and_indicator(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        # ---- Step 1: establish a conversation so there is context to compact.
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        initial_ai = page.locator(AI_BUBBLE).count()
        _send_via_input(page, "Hello. Please answer briefly: what is 2+2?")
        assert _wait_bubble_count(page, initial_ai + 1), (
            "no reply after the seed message"
        )

        # ---- Step 2: /compact via the input box. It is a command-class
        # response: no new bubble is expected, the session must stay healthy.
        before_compact = page.locator(AI_BUBBLE).count()
        _send_via_input(page, "/compact")
        page.wait_for_timeout(8000)
        # The command must not crash the page: the input stays mounted.
        assert page.locator("textarea").first.count() > 0, (
            "chat input disappeared after /compact"
        )
        logger.info(
            "/compact issued; ai bubbles before=%d after=%d",
            before_compact,
            page.locator(AI_BUBBLE).count(),
        )

        # ---- Step 3: Compact via the context-usage indicator button (UI path).
        indicator = page.locator(CTX_INDICATOR).first
        if indicator.count() > 0:
            indicator.click()
            page.wait_for_timeout(1000)
            compact_btn = page.locator(
                "button:has-text('Compact'), button:has-text('压缩')"
            ).first
            if compact_btn.count() > 0:
                compact_btn.click()
                page.wait_for_timeout(8000)
                logger.info("indicator Compact button clicked")
            else:
                logger.warning("Compact button not found in indicator popover")
            # close the popover if it is still open (press Escape)
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        else:
            logger.warning("context indicator not present; skipping UI path")

        # ---- Step 4: the session still works after compaction — a follow-up
        # message must receive a reply.
        follow_ai = page.locator(AI_BUBBLE).count()
        _send_via_input(page, "One more brief question: what is 3+3?")
        assert _wait_bubble_count(page, follow_ai + 1), (
            "session broken after /compact — no reply to the follow-up message"
        )

        logger.info("Test %s passed", test_name)
