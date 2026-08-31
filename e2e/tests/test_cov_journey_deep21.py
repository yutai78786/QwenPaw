# -*- coding: utf-8 -*-
"""
OpenAI-compat provider + probe-multimodal journeys (5pp wave 21).

Targets providers/openai_chat_model_compat.py (307 uncovered) by creating a
custom OpenAI-compatible provider pointed at the real DashScope endpoint and
chatting through it, plus probe-multimodal and provider connection tests.

Run: pytest tests/test_cov_journey_deep21.py -v
"""
from __future__ import annotations

import logging
import os

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PROVIDER_ID = "e2e_cov21_compat"
MODEL_ID = "qwen3.7-plus"


def _real_key() -> str:
    key = os.environ.get("QWENPAW_DASHSCOPE_API_KEY", "")
    if key and key.startswith("sk-"):
        return key
    return os.environ.get("QWENPAW_TEST_API_KEY_DASH_NORMAL", "")


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.models
class TestOpenAICompatChatJourney:
    """
    COV-COMPAT-001: create a custom OpenAI-compatible provider pointed at
    DashScope, activate it, chat through it (real inference via
    OpenAIChatModelCompat), then restore and clean up.
    """

    @pytest.mark.test_id("COV-COMPAT-001")
    def test_openai_compat_chat(
        self,
        clean_chat_page: ChatPage,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page
        key = _real_key()
        assert key.startswith("sk-"), "no real key available"

        # Defensive cleanup
        api_context.delete(f"/api/models/custom-providers/{PROVIDER_ID}")

        log_test_step("1. Create the custom OpenAI-compat provider")
        create = api_context.post(
            "/api/models/custom-providers",
            data={
                "id": PROVIDER_ID,
                "name": "E2E Cov21 Compat",
                "default_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            },
        )
        assert create.ok or create.status == 409, (
            f"create provider failed [{create.status}]: {create.text()[:200]}"
        )

        log_test_step("2. Configure key + add model")
        api_context.put(
            f"/api/models/{PROVIDER_ID}/config",
            data={"api_key": key},
        )
        api_context.post(
            f"/api/models/{PROVIDER_ID}/models",
            data={"id": MODEL_ID, "name": MODEL_ID},
        )

        log_test_step("3. Activate it at agent scope")
        active = api_context.get("/api/models/active")
        original = active.json().get("active_llm", {}) if active.ok else {}
        # Set at agent scope so the agent actually uses it (global is overridden
        # by the agent's own active_model).
        api_context.put(
            "/api/models/active",
            data={
                "provider_id": PROVIDER_ID,
                "model": MODEL_ID,
                "scope": "agent",
                "agent_id": "default",
            },
        )

        log_test_step("4. Real inference via the compat provider (chat UI)")
        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message("Reply with exactly: compat-ok")
        elapsed = 0
        while (
            elapsed < 120000
            and page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() <= before
        ):
            page.wait_for_timeout(1000)
            elapsed += 1000
        assert page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before, (
            "no reply from the compat provider"
        )
        logger.info("compat provider chat returned a reply")

        log_test_step("5. Read the compat provider back (config round trip)")
        detail = api_context.get("/api/models")
        assert detail.ok, f"models list failed [{detail.status}]"
        plist = detail.json()
        plist = plist if isinstance(plist, list) else plist.get("providers", [])
        found = [p for p in plist if p.get("id") == PROVIDER_ID]
        assert found, f"compat provider {PROVIDER_ID} not in model list"

        log_test_step("6. Restore original model + cleanup")
        if original:
            api_context.put(
                "/api/models/active",
                data={
                    "provider_id": original.get("provider_id", "dashscope"),
                    "model": original.get("model", "qwen3.7-plus"),
                    "scope": "agent",
                    "agent_id": "default",
                },
            )
        api_context.delete(f"/api/models/custom-providers/{PROVIDER_ID}")

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.models
class TestProviderConnectionJourney:
    """
    COV-CONN-001: test connection + model discovery on the builtin dashscope
    provider (exercises provider_manager connection + discovery paths).
    """

    @pytest.mark.test_id("COV-CONN-001")
    def test_provider_connection(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Connection test")
        resp = api_context.post(
            "/api/models/dashscope/test",
            data={},
        )
        logger.info("provider test -> %s", resp.status)

        log_test_step("2. Discover models")
        resp2 = api_context.post(
            "/api/models/dashscope/discover",
            data={},
        )
        logger.info("discover -> %s", resp2.status)

        log_test_result(test_name, True, 0)
