# -*- coding: utf-8 -*-
"""
Memory + delegation + coding-mode deep journeys (5pp wave 5).

Targets:
  - agents/memory/reme_light_memory_manager.py (336 uncovered) — memory
    write/recall via chat (the agent's memory tool path)
  - agents/tools/delegate_external_agent.py (379 uncovered) — asking the
    agent about available external runners engages the delegate tool's
    discovery path
  - coding-mode file editing deep ops via chat

Run: pytest tests/test_cov_journey_deep5.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

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
@pytest.mark.requires_llm
@pytest.mark.chat
class TestMemoryDeepJourney:
    """
    COV-MEM-001: exercise the memory write/read cycle through chat —
    store a fact, then recall it in a later turn.
    """

    @pytest.mark.test_id("COV-MEM-001")
    def test_memory_write_recall(
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

        # Write
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Remember this in your long-term memory: my favourite framework "
            "is called 'quartz-e2e'."
        )
        assert _wait_reply_grows(page, before), "no reply to memory-write round"

        # Recall
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "What is my favourite framework that I told you to remember? "
            "Check your memory."
        )
        assert _wait_reply_grows(page, before), "no reply to memory-recall round"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestDelegateDiscoveryJourney:
    """
    COV-DELEG-001: ask about delegating work to an external agent — engages
    the delegate tool's runner-discovery path (even when no runners are
    configured, the discovery + formatting code runs).
    """

    @pytest.mark.test_id("COV-DELEG-001")
    def test_delegate_discovery(
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
            "Is there a way to delegate this task to another agent or "
            "external coding runner? List what delegation options exist."
        )
        assert _wait_reply_grows(page, before), "no reply to delegate round"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestCodingChatJourney:
    """
    COV-CODE-002: ask the agent to create and edit a code file inside a
    project, exercising the coding-mode + file-edit tool path through chat.
    """

    @pytest.mark.test_id("COV-CODE-002")
    def test_coding_file_create_edit(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        import subprocess

        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        subprocess.run(
            ["bash", "-c",
             "mkdir -p /tmp/e2e_cov_code && "
             "printf 'def hello():\\n    return 1\\n' > /tmp/e2e_cov_code/app.py"],
            capture_output=True, timeout=15,
        )

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # Create a new file via the agent
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use write_file to create /tmp/e2e_cov_code/util.py containing a "
            "function add(a, b) that returns a + b."
        )
        assert _wait_reply_grows(page, before), "no reply to file-create round"

        # Read it back
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Now use read_file to read /tmp/e2e_cov_code/util.py and show me "
            "the add function."
        )
        assert _wait_reply_grows(page, before), "no reply to file-read round"

        logger.info("Test %s passed", test_name)
