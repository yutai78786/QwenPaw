# -*- coding: utf-8 -*-
"""
Deep tool + long-context journeys (5pp wave 16).

More journey diversity to push the probabilistic tool-execution coverage:
  - grep/glob/ast_search file tools
  - multi-step shell with files
  - long session with many tool calls (scroll manager accumulation)

Run: pytest tests/test_cov_journey_deep16.py -v
"""
from __future__ import annotations

import logging
import subprocess

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
class TestSearchToolsJourney:
    """COV-SEARCH-001: grep/glob/read tools on a seeded tree."""

    @pytest.mark.test_id("COV-SEARCH-001")
    def test_search_tools(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page

        # Seed a tree to search
        subprocess.run(
            ["bash", "-c",
             "mkdir -p /tmp/e2e_s16/src && "
             "printf 'def alpha():\\n    return 1\\n' > /tmp/e2e_s16/src/a.py && "
             "printf 'def beta():\\n    return 2\\n' > /tmp/e2e_s16/src/b.py && "
             "printf '# readme\\n' > /tmp/e2e_s16/README.md"],
            capture_output=True, timeout=15,
        )

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        prompts = [
            "Use glob_search to list every .py file under /tmp/e2e_s16.",
            "Use grep_search to find where 'def alpha' is defined under /tmp/e2e_s16.",
            "Use read_file to read /tmp/e2e_s16/README.md.",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to search prompt {i}"
        logger.info("search tools journey done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestMultiStepFileOpsJourney:
    """COV-FILEOPS-001: write + read + edit a file across turns."""

    @pytest.mark.test_id("COV-FILEOPS-001")
    def test_multi_step_file_ops(
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
            "Use write_file to create /tmp/e2e_s16_note.txt containing 'step one'.",
            "Now use execute_shell_command to append the line 'step two' to "
            "/tmp/e2e_s16_note.txt.",
            "Use read_file to show me the full contents of /tmp/e2e_s16_note.txt.",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to file-ops prompt {i}"
        logger.info("multi-step file ops done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestLongToolSessionJourney:
    """COV-LONGTOOL-001: many tool calls in one session (scroll + coordinator)."""

    @pytest.mark.test_id("COV-LONGTOOL-001")
    def test_long_tool_session(
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
            "Use execute_shell_command to run: echo one",
            "Use execute_shell_command to run: echo two",
            "Use execute_shell_command to run: echo three",
            "Use glob_search to list files in /tmp matching *.md (limit 5).",
            "Use execute_shell_command to run: echo done",
            "Now briefly summarize the outputs you saw.",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to long-tool prompt {i}"
        logger.info("long tool session done")
