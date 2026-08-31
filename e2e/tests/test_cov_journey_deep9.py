# -*- coding: utf-8 -*-
"""
Shell/model/workspace extra-depth journeys (5pp wave 9).

Further probes into the still-large reachable blocks:
  - agents/tools/shell.py            (470) — heredoc, redirect, pipe, stderr
  - agents/model_factory.py          (498) — model switching mid-session
  - app/routers/workspace.py         (478) — html-file-uri + more tree paths
  - agents/tools/run_tool_batch.py   (331) — conditional goto + error handling

Run: pytest tests/test_cov_journey_deep9.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

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
class TestShellExtraVariants:
    """
    COV-SHELL-003: shell redirect, pipe chains, stderr, and a non-trivial
    script — covers more shell.py branches.
    """

    @pytest.mark.test_id("COV-SHELL-003")
    def test_shell_extra_variants(
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

        prompts = [
            "Use execute_shell_command to run: echo 'line a' > /tmp/e2e_s9.txt && cat /tmp/e2e_s9.txt",
            "Use execute_shell_command to run: ls /tmp | grep e2e | head -3",
            "Use execute_shell_command to run: cat /tmp/does_not_exist_99 2>&1 ; echo exit=$?",
        ]
        for i, prompt in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(prompt)
            assert _wait_reply_grows(page, before), f"no reply to shell variant {i}"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestModelSwitchJourney:
    """
    COV-MODEL-002: switch the active model mid-session and continue chatting —
    exercises model_factory rebuild + provider reload paths.
    """

    @pytest.mark.test_id("COV-MODEL-002")
    def test_model_switch_and_chat(
        self,
        clean_chat_page: ChatPage,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        # Chat with the default model
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("Say exactly: model-one")
        assert _wait_reply_grows(page, before), "no reply before model switch"

        # Read the current active model
        active = api_context.get("/api/models/active")
        assert active.ok, "read active model failed"
        original = active.json().get("active_llm", {})
        orig_model = original.get("model", "qwen3.7-plus")

        # Switch to a different model variant if available
        providers = api_context.get("/api/models").json()
        plist = providers if isinstance(providers, list) else providers.get("providers", [])
        candidate = None
        for p in plist:
            if p.get("id") == "dashscope":
                for m in p.get("models", []):
                    mid = m.get("id", "")
                    if mid and mid != orig_model:
                        candidate = mid
                        break
        if candidate:
            api_context.put(
                "/api/models/active",
                data={"provider_id": "dashscope", "model": candidate, "scope": "global"},
            )
            logger.info("switched model to %s", candidate)

        # Continue chatting after the switch
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("Say exactly: model-two")
        assert _wait_reply_grows(page, before), "no reply after model switch"

        # Restore original model
        api_context.put(
            "/api/models/active",
            data={"provider_id": "dashscope", "model": orig_model, "scope": "global"},
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestConditionalBatchJourney:
    """
    COV-BATCH-002: run_tool_batch with a conditional goto that terminates
    early and one step that errors — covers the conditional branch and
    error-handling paths of run_tool_batch.py.
    """

    @pytest.mark.test_id("COV-BATCH-002")
    def test_conditional_batch(
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
            "Use run_tool_batch with this actions JSON: step 0 is "
            "execute_shell_command running 'echo first'; step 1 is a set_var "
            "with expr \"x=1\"; step 2 is a goto to label \"end\" with "
            "condition \"${vars.x}==1\"; step 3 is a label named \"end\"; "
            "step 4 is execute_shell_command running 'echo done'. Tell me the "
            "final output."
        )
        assert _wait_reply_grows(page, before, timeout_ms=180000), (
            "no reply to conditional batch round"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.files
class TestWorkspaceHtmlUriJourney:
    """
    COV-WS-002: hit html-file-uri and the system-prompt-files endpoints —
    the remaining workspace router paths.
    """

    @pytest.mark.test_id("COV-WS-002")
    def test_workspace_html_uri(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read system-prompt-files")
        resp = api_context.get("/api/workspace/system-prompt-files",
                               headers={"X-Agent-Id": "default"})
        logger.info("system-prompt-files -> %s", resp.status)

        log_test_step("2. Resolve html-file-uri for an md file")
        resp2 = api_context.get(
            "/api/workspace/html-file-uri",
            params={"path": "AGENTS.md", "root": "project"},
            headers={"X-Agent-Id": "default"},
        )
        logger.info("html-file-uri -> %s", resp2.status)

        log_test_step("3. List files")
        resp3 = api_context.get("/api/workspace/files",
                                headers={"X-Agent-Id": "default"})
        assert resp3.ok, f"files list failed [{resp3.status}]"

        log_test_result(test_name, True, 0)
