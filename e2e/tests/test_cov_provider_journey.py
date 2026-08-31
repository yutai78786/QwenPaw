# -*- coding: utf-8 -*-
"""
Custom-provider coverage journey (5pp wave).

Creates a custom OpenAI-compatible provider pointed at the real DashScope
endpoint, configures its key, discovers/adds a model, switches the active
model to it and chats — exercising:
  - providers/openai_chat_model_compat.py (422 uncovered, 0%)
  - agents/model_factory.py               (472 uncovered)
  - providers/provider_manager_persistence.py (296 uncovered)

Cleanup restores the default active model and deletes the custom provider.

Run: pytest tests/test_cov_provider_journey.py -v
"""
from __future__ import annotations

import logging
import os
import time

import pytest
from playwright.sync_api import Page, expect

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PROVIDER_ID = "e2e_cov_provider"
MODEL_ID = "qwen3.7-plus"
DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def _real_key() -> str:
    """Resolve the real DashScope key (env value, not the placeholder name)."""
    key = os.environ.get("QWENPAW_DASHSCOPE_API_KEY", "")
    if key and key.startswith("sk-"):
        return key
    # Fallback: the env may hold a placeholder name to be expanded by the shell
    inner = os.environ.get("QWENPAW_TEST_API_KEY_DASH_NORMAL", "")
    return inner


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.models
class TestCustomProviderJourney:
    """
    COV-PROV-001: create -> configure -> add model -> activate -> chat -> cleanup.
    """

    @pytest.mark.test_id("COV-PROV-001")
    def test_custom_provider_journey(
        self,
        page: Page,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        key = _real_key()
        assert key and key.startswith("sk-"), (
            "real DashScope key unavailable — cannot run provider journey"
        )

        # Defensive cleanup from a previous run
        api_context.delete(f"/api/models/custom-providers/{PROVIDER_ID}")

        log_test_step("1. Create the custom provider via API")
        resp = api_context.post(
            "/api/models/custom-providers",
            data={
                "id": PROVIDER_ID,
                "name": "E2E Coverage Provider",
                "default_base_url": DASHSCOPE_BASE_URL,
            },
        )
        assert resp.ok, f"create provider failed [{resp.status}]: {resp.text()[:200]}"

        log_test_step("2. Configure the API key")
        resp = api_context.put(
            f"/api/models/{PROVIDER_ID}/config",
            data={"api_key": key},
        )
        assert resp.ok, f"config key failed [{resp.status}]"

        log_test_step("3. Add a model to the provider")
        resp = api_context.post(
            f"/api/models/{PROVIDER_ID}/models",
            data={"id": MODEL_ID, "name": MODEL_ID},
        )
        assert resp.ok, f"add model failed [{resp.status}]: {resp.text()[:200]}"

        log_test_step("4. Open the Models page and verify the provider renders")
        page.goto(f"{config.base_url}/models")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        # Hard check via API: the provider is registered as custom. The page's
        # Local & Custom section lazy-renders off-screen cards, so treat the
        # visual check as soft (log a warning if not yet mounted).
        listing = api_context.get("/api/models")
        assert listing.ok, "provider listing failed"
        providers = listing.json()
        if isinstance(providers, dict):
            providers = providers.get("providers", [])
        match = [p for p in providers if p.get("id") == PROVIDER_ID]
        assert match and match[0].get("is_custom"), (
            "custom provider not registered via API"
        )
        page.mouse.wheel(0, 3000)
        page.wait_for_timeout(1500)
        body_text = page.locator("body").inner_text()
        if "E2E Coverage Provider" in body_text or PROVIDER_ID in body_text:
            logger.info("custom provider card rendered on the models page")
        else:
            logger.warning(
                "custom provider card not yet mounted (lazy list); API check passed"
            )

        log_test_step("5. Set the active model to the custom provider")
        resp = api_context.put(
            "/api/models/active",
            data={"provider_id": PROVIDER_ID, "model": MODEL_ID, "scope": "global"},
        )
        assert resp.ok, f"set active failed [{resp.status}]: {resp.text()[:200]}"

        log_result = log_test_result
        try:
            log_test_step("6. Chat with the custom provider (real inference)")
            chat = ChatPage(page)
            page.goto(f"{config.base_url}/chat")
            page.wait_for_load_state("domcontentloaded")
            chat.create_new_chat()
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message("Answer with exactly one word: ready")
            elapsed = 0
            while (
                elapsed < 90000
                and page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
                <= before
            ):
                page.wait_for_timeout(1000)
                elapsed += 1000
            assert (
                page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before
            ), "no reply from the custom provider model"
            log_result(test_name, True, 0)
        finally:
            log_test_step("7. Cleanup: restore default model, delete provider")
            api_context.put(
                "/api/models/active",
                data={"provider_id": "dashscope", "model": MODEL_ID, "scope": "global"},
            )
            api_context.delete(f"/api/models/custom-providers/{PROVIDER_ID}")
