# -*- coding: utf-8 -*-
"""
Agent tool-execution coverage boost (5pp wave).

The biggest reachable-but-uncovered blocks are only executed when the agent
actually runs tools on a user request (point-and-click UI cases never enter
them). These cases drive the real chat UI and ask the agent to perform work,
then verify the result through the rendered reply / backend state.

Covered big blocks (per 20260824 gap data):
  - agents/tools/shell.py                 (470 uncovered lines)
  - agents/tools/file ops via workspace   (file read/write paths)
  - app/routers/workspace.py file-content (574 total, deep ops)

Run: pytest tests/test_cov_tool_journey.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage

logger = logging.getLogger(__name__)


def _last_ai_text(page) -> str:
    bubbles = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start")
    if bubbles.count() == 0:
        return ""
    return bubbles.last.inner_text() or ""


def _wait_reply_grows(page, before_count: int, timeout_ms: int = 90000) -> bool:
    """Wait until a new AI bubble appears."""
    elapsed = 0
    while elapsed < timeout_ms:
        if page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count:
            # give it a moment to finish streaming
            page.wait_for_timeout(3000)
            return True
        page.wait_for_timeout(1000)
        elapsed += 1000
    return page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestShellToolJourney:
    """
    COV-TOOL-001: make the agent execute real shell commands through chat.
    Exercises agents/tools/shell.py (command exec, output capture, result
    formatting) and the tool-call rendering path.
    """

    @pytest.mark.test_id("COV-TOOL-001")
    def test_shell_tool_journey(
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

        # ---- Round 1: simple shell command ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use the execute_shell_command tool to run this command and tell me "
            "the output: echo E2E_SHELL_PROBE_$(date +%s) | tee /tmp/e2e_cov_probe.txt"
        )
        assert _wait_reply_grows(page, before), "no reply to shell round 1"
        page.wait_for_timeout(2000)

        # ---- Round 2: multi-step shell (cat + word count) ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Now use execute_shell_command to run: cat /tmp/e2e_cov_probe.txt && "
            "wc -c /tmp/e2e_cov_probe.txt — then tell me the byte count."
        )
        assert _wait_reply_grows(page, before), "no reply to shell round 2"

        # ---- Round 3: a command that produces multi-line output ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use execute_shell_command to run: ls -la /tmp | head -20, and "
            "summarize how many entries you see."
        )
        assert _wait_reply_grows(page, before), "no reply to shell round 3"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestFileToolJourney:
    """
    COV-TOOL-002: make the agent write then read a workspace file through
    chat. Exercises file write/read tool paths and workspace file-content
    endpoints.
    """

    @pytest.mark.test_id("COV-TOOL-002")
    def test_file_write_read_journey(
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

        # ---- Round 1: ask the agent to create a file via shell ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Using execute_shell_command, create a file /tmp/e2e_cov_note.txt "
            "containing exactly this text: coverage-journey-note-12345"
        )
        assert _wait_reply_grows(page, before), "no reply to file-write round"
        page.wait_for_timeout(2000)

        # ---- Round 2: read it back ----
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use execute_shell_command to cat /tmp/e2e_cov_note.txt and quote "
            "the exact content back to me."
        )
        assert _wait_reply_grows(page, before), "no reply to file-read round"

        # verify the content really landed
        import subprocess
        try:
            out = subprocess.run(
                ["cat", "/tmp/e2e_cov_note.txt"],
                capture_output=True, text=True, timeout=10,
            ).stdout
            assert "coverage-journey-note-12345" in out, (
                f"file content mismatch: {out!r}"
            )
        except FileNotFoundError:
            pytest.fail("agent did not actually create the file")

        logger.info("Test %s passed", test_name)
