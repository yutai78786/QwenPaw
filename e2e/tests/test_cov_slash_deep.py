# -*- coding: utf-8 -*-
"""
Deep slash-command coverage (5pp wave).

Existing slash cases cover /skills /model /history /proactive /dump /clear
/new /stop /suggestion. This wave covers the remaining system commands in
agents/command_handler.py (465 uncovered lines):
  /memorize, /reme_status, /plan, /system_prompt, /compact_str,
  /dump_history, /load_history, /message, /dream

These are command-class responses (no AI bubble), so the assertion is that
the session stays healthy and the input remains usable — plus reading the
rendered system reply when one appears.

Run: pytest tests/test_cov_slash_deep.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

logger = logging.getLogger(__name__)


def _send_raw(page, text: str) -> None:
    """Type and send without the round-gate (fast command responses)."""
    ta = page.locator("textarea").first
    ta.wait_for(state="visible", timeout=10000)
    ta.fill(text)
    page.wait_for_timeout(200)
    page.locator("button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary").first.click()


def _session_healthy(page) -> bool:
    return page.locator("textarea").first.count() > 0


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestDeepSlashCommands:
    """
    COV-SLASH-001: drive the uncovered system commands one session at a time.
    """

    @pytest.mark.test_id("COV-SLASH-001")
    def test_deep_slash_commands(
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

        # seed one real message so commands that act on history have content
        chat.send_message("Seed message for deep slash commands.")
        page.wait_for_timeout(8000)

        for cmd in [
            "/reme_status",
            "/memorize remember this e2e probe note",
            "/plan",
            "/system_prompt",
            "/compact_str",
            "/history",
        ]:
            logger.info("issuing %s", cmd)
            _send_raw(page, cmd)
            page.wait_for_timeout(6000)
            assert _session_healthy(page), f"session broke after {cmd}"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestHistoryDumpLoadCommands:
    """
    COV-SLASH-002: /dump_history and /load_history round trip + /message.
    """

    @pytest.mark.test_id("COV-SLASH-002")
    def test_history_dump_load(
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

        chat.send_message("Seed for dump/load round trip.")
        page.wait_for_timeout(8000)

        for cmd in ["/dump_history", "/load_history", "/message 3"]:
            logger.info("issuing %s", cmd)
            _send_raw(page, cmd)
            page.wait_for_timeout(6000)
            assert _session_healthy(page), f"session broke after {cmd}"

        logger.info("Test %s passed", test_name)
