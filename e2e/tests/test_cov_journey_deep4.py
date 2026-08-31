# -*- coding: utf-8 -*-
"""
Batch control-flow + deep browser + deep recall journeys (5pp wave 4).

Targets the branches not hit by the simple two-step batch:
  - agents/tools/run_tool_batch.py (331 still uncovered) — control flow:
    labels, goto, set_var, step refs ${steps.N...}
  - browser/execution/worker.py + tool_entrypoint — multi-step browsing
  - agents/context/scroll/memoryspace.py (373) — durable recall searches

Run: pytest tests/test_cov_journey_deep4.py -v
"""
from __future__ import annotations

import logging
import subprocess

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
class TestBatchControlFlowJourney:
    """
    COV-BATCH-001: ask the agent to run a run_tool_batch with control
    flow (a loop via label/goto/set_var) and step references. Covers the
    control-flow and reference-resolution branches of run_tool_batch.py.
    """

    @pytest.mark.test_id("COV-BATCH-001")
    def test_batch_control_flow(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        # Seed files the loop will process
        subprocess.run(
            ["bash", "-c",
             "mkdir -p /tmp/e2e_cov_batch && "
             "echo alpha > /tmp/e2e_cov_batch/a.txt && "
             "echo beta > /tmp/e2e_cov_batch/b.txt && "
             "echo gamma > /tmp/e2e_cov_batch/c.txt"],
            capture_output=True, timeout=15,
        )

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use run_tool_batch to process three files with a loop. Build the "
            "actions JSON like this: step 0 uses execute_shell_command to run "
            "'ls /tmp/e2e_cov_batch'; then a set_var step with expr \"i=1\"; "
            "then a label named \"next\"; then an execute_shell_command step "
            "running 'sed -n \"${vars.i}p\" <<< \"$(ls /tmp/e2e_cov_batch)\"'; "
            "then a set_var step with expr \"i=${vars.i}+1\"; then a goto step "
            "to label \"next\" with condition \"${vars.i}<=3\". After the loop "
            "tell me the three file names you collected."
        )
        assert _wait_reply_grows(page, before, timeout_ms=180000), (
            "no reply to batch control-flow round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestDeepBrowserJourney:
    """
    COV-BROWSER-002: multi-step browser session — open a page, extract
    text, then take a screenshot — exercising the browser tool beyond a
    single navigation.
    """

    @pytest.mark.test_id("COV-BROWSER-002")
    def test_deep_browser_session(
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
            "Using the browser tool: first open http://localhost:6267/files, "
            "then extract the text of the page's main heading or title, and "
            "report what you found in one sentence."
        )
        assert _wait_reply_grows(page, before, timeout_ms=180000), (
            "no reply to deep browser round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestDeepRecallJourney:
    """
    COV-RECALL-001: make the agent do a keyword search over its durable
    history (recall tool search path) across earlier turns.
    """

    @pytest.mark.test_id("COV-RECALL-001")
    def test_deep_recall_search(
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

        # Seed distinctive content
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Please remember: the project codename is 'zeppelin-anchor-88'."
        )
        assert _wait_reply_grows(page, before), "no reply to seed round"

        # Ask for a search over history
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Search your recorded conversation history for the keyword "
            "'zeppelin' and quote back the sentence where it appears."
        )
        assert _wait_reply_grows(page, before, timeout_ms=150000), (
            "no reply to deep recall round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestLongSessionAccumulation:
    """
    COV-LONG-001: a 10-turn session mixing questions, file requests and a
    tool call — accumulates coverage on shared streaming/session plumbing
    (channels/base stream path, scroll manager turn handling).
    """

    @pytest.mark.test_id("COV-LONG-001")
    def test_long_session_accumulation(
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

        turns = [
            "What is 10 times 7?",
            "Name one river in Brazil.",
            "Use execute_shell_command to run: date",
            "Give me a two-word synonym for 'happy'.",
            "What color do you get mixing red and white?",
            "Name one planet without rings.",
            "Translate 'good morning' to French.",
            "What is the square root of 81?",
            "Name a programming language starting with R.",
            "Finally, summarize our chat in one sentence.",
        ]
        for i, t in enumerate(turns, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(t)
            assert _wait_reply_grows(page, before), f"no reply to turn {i}: {t[:20]}"

        logger.info("Test %s passed", test_name)
