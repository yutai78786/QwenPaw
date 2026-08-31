# -*- coding: utf-8 -*-
"""
Tool-batch + browser + file-search coverage journeys (5pp wave).

Big blocks only reached when the agent actually invokes these tools:
  - agents/tools/run_tool_batch.py            (466 uncovered)
  - browser/execution/{worker,subprocess_plane,adapter} (~930 uncovered)
  - file search tools (grep/glob/ast_search)

Run: pytest tests/test_cov_tool_deep2.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

logger = logging.getLogger(__name__)


def _wait_reply_grows(page, before_count: int, timeout_ms: int = 120000) -> bool:
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
class TestRunToolBatchJourney:
    """
    COV-TOOL-003: ask the agent to use run_tool_batch to run several tool
    steps in one batch with references between steps. Exercises
    agents/tools/run_tool_batch.py (batch parsing, step refs, control flow).
    """

    @pytest.mark.test_id("COV-TOOL-003")
    def test_run_tool_batch_journey(
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
            "Use the run_tool_batch tool to run a small batch: step 1 uses "
            "execute_shell_command to run 'echo batch-step-one'; step 2 uses "
            "execute_shell_command to run 'echo batch-step-two'. Then tell me "
            "the combined output of both steps."
        )
        assert _wait_reply_grows(page, before), "no reply to run_tool_batch round"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestBrowserToolJourney:
    """
    COV-TOOL-004: ask the agent to open a page with the browser tool.
    Exercises browser/execution worker + subprocess plane + adapter.
    """

    @pytest.mark.test_id("COV-TOOL-004")
    def test_browser_tool_journey(
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
            "Use the browser tool to open http://localhost:6267 and report the "
            "page title you see. Keep it to one short sentence."
        )
        assert _wait_reply_grows(page, before), "no reply to browser round"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestFileSearchToolJourney:
    """
    COV-TOOL-005: ask the agent to search files with grep/glob/read tools.
    Exercises the file-search tool implementations.
    """

    @pytest.mark.test_id("COV-TOOL-005")
    def test_file_search_tool_journey(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        import subprocess

        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        # Seed a searchable file tree
        subprocess.run(
            ["bash", "-c",
             "mkdir -p /tmp/e2e_cov_search && "
             "printf 'alpha-content-9\\n' > /tmp/e2e_cov_search/one.txt && "
             "printf 'beta-content-9\\n' > /tmp/e2e_cov_search/two.md"],
            capture_output=True, timeout=15,
        )

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # glob + grep
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use glob_search to list all files under /tmp/e2e_cov_search, then "
            "use grep_search to find which file contains 'alpha-content'. "
            "Tell me the file name."
        )
        assert _wait_reply_grows(page, before), "no reply to search round"

        # read
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use read_file to read /tmp/e2e_cov_search/two.md and quote its "
            "content."
        )
        assert _wait_reply_grows(page, before), "no reply to read round"

        logger.info("Test %s passed", test_name)
