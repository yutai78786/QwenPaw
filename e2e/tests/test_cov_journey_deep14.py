# -*- coding: utf-8 -*-
"""
Tool-execution diversity + fork journey (5pp wave 14).

Targets the largest blocks still driven only when the agent actually invokes
tools / forks a project:
  - agents/fork_project.py                  (813) — fork a project via chat
  - agents/context/scroll/manager.py        (543) — scroll state during long session
  - agents/tools/agent_management.py        (517) — agent info tool
  - agents/tools/shell.py                   (470) — varied shell forms
  - agents/context/scroll/memoryspace.py    (373) — memory search
  - agents/model_factory.py                 (498) — model rebuild on switch

These are journey cases; the LLM decides tool usage, so coverage accrues
probabilistically across repeated measurement rounds (union method).

Run: pytest tests/test_cov_journey_deep14.py -v
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
class TestShellDiversityJourney:
    """COV-SHELL-004: many distinct shell invocations in one session."""

    @pytest.mark.test_id("COV-SHELL-004")
    def test_shell_diversity(
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
            "Use execute_shell_command to run: pwd && whoami",
            "Use execute_shell_command to run: date +%Y-%m-%d",
            "Use execute_shell_command to run: uname -a | head -1",
            "Use execute_shell_command to run: ls -1 /tmp | wc -l",
            "Use execute_shell_command to run: echo $((2+3))",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to shell prompt {i}"
        logger.info("shell diversity done")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestAgentInfoToolJourney:
    """COV-AGMGMT-001: ask the agent about itself / the system."""

    @pytest.mark.test_id("COV-AGMGMT-001")
    def test_agent_info_tool(
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
            "What model are you running right now? Use any available tool to check.",
            "Tell me the current workspace directory path.",
            "What tools do you have available? List a few.",
        ]
        for i, p in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(p)
            assert _wait_reply(page, before), f"no reply to agent-info prompt {i}"
        logger.info("agent info journey done")


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestMemorySearchJourney:
    """COV-MEMSPACE-001: drive memory search/recall through chat."""

    @pytest.mark.test_id("COV-MEMSPACE-001")
    def test_memory_search(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        chat = clean_chat_page
        page = chat.page
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # Seed then search
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("Remember: the secret garden code is 'amber-falcon-3'.")
        assert _wait_reply(page, before), "no reply to seed"

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Search your memory for 'garden' and tell me what you find."
        )
        assert _wait_reply(page, before), "no reply to memory search"
        logger.info("memory search journey done")


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestForkProjectJourney:
    """COV-FORK-001: ask the agent to fork/duplicate the current project."""

    @pytest.mark.test_id("COV-FORK-001")
    def test_fork_project(
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

        # Seed a project dir first
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Fork my current project into a new branch so I can experiment "
            "safely. If there is no active project, tell me that."
        )
        assert _wait_reply(page, before, timeout_ms=180000), "no reply to fork"

        # Cleanup binding
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})
        logger.info("fork journey done")
