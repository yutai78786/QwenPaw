# -*- coding: utf-8 -*-
"""
MCP streamable-http + big-context compression journeys (5pp wave 11).

Targets:
  - drivers/handlers/mcp_streamable_http.py (313 uncovered) — create/read/
    delete a streamable_http MCP client
  - agents/context/visual_compression/rendering/renderer.py (361 uncovered) —
    trigger a long-context compression via many turns

Run: pytest tests/test_cov_journey_deep11.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

MCP_KEY = "e2e_cov11_http"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.mcp
class TestMCPStreamableHTTPJourney:
    """
    COV-MCP-001: create a streamable_http MCP client via API, read it back,
    list tools, then delete it. Exercises the streamable-http handler +
    MCP client CRUD paths.
    """

    @pytest.mark.test_id("COV-MCP-001")
    def test_mcp_streamable_http_crud(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        # Defensive cleanup
        api_context.delete(f"/api/mcp/{MCP_KEY}", headers=H)

        log_test_step("1. Create a streamable_http MCP client")
        resp = api_context.post(
            "/api/mcp",
            data={
                "client_key": MCP_KEY,
                "client": {
                    "name": "E2E Coverage HTTP MCP",
                    "description": "coverage probe",
                    "enabled": False,
                    "transport": "streamable_http",
                    "url": "http://127.0.0.1:1/mcp",
                    "headers": {},
                    "command": "",
                    "args": [],
                    "env": {},
                    "cwd": "",
                },
            },
            headers=H,
        )
        assert resp.ok, f"mcp create failed [{resp.status}]: {resp.text()[:200]}"
        logger.info("mcp client created")

        log_test_step("2. Read it back + list MCP clients")
        detail = api_context.get(f"/api/mcp/{MCP_KEY}", headers=H)
        assert detail.ok, f"mcp detail failed [{detail.status}]"
        listing = api_context.get("/api/mcp", headers=H)
        assert listing.ok, f"mcp list failed [{listing.status}]"

        log_test_step("3. Read tools + policy for the client")
        tools = api_context.get(f"/api/mcp/tools/{MCP_KEY}", headers=H)
        logger.info("mcp tools -> %s", tools.status)
        policy = api_context.get(f"/api/mcp/policy/{MCP_KEY}", headers=H)
        logger.info("mcp policy -> %s", policy.status)

        log_test_step("4. Toggle then delete (cleanup)")
        api_context.patch(f"/api/mcp/toggle/{MCP_KEY}", headers=H)
        del_resp = api_context.delete(f"/api/mcp/{MCP_KEY}", headers=H)
        assert del_resp.ok or del_resp.status == 404, (
            f"mcp delete failed [{del_resp.status}]"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestManyTurnCompressionJourney:
    """
    COV-COMP-001: run a long multi-turn session then force /compact, to
    exercise the visual-compression rendering path with real history.
    """

    @pytest.mark.test_id("COV-COMP-001")
    def test_many_turn_compression(
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
            "Name a country in Europe.",
            "Name a country in Asia.",
            "Name a country in Africa.",
            "Name an ocean.",
            "Name a mountain.",
            "Name a river in Asia.",
            "Name a desert.",
            "Name a lake.",
        ]
        for t in turns:
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(t)
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
            ), f"no reply to turn: {t}"

        # Force compaction over the long history
        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        ta = page.locator("textarea").first
        ta.fill("/compact")
        page.wait_for_timeout(200)
        page.locator("button.qwenpaw-sender-actions-btn.qwenpaw-btn-primary").first.click()
        page.wait_for_timeout(12000)
        assert page.locator("textarea").first.count() > 0, (
            "session broke after compaction"
        )

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.mcp
class TestMCPAccessPrincipalsJourney:
    """
    COV-MCP-002: read MCP access-principals and the MCP OAuth endpoint —
    exercises the remaining small MCP paths.
    """

    @pytest.mark.test_id("COV-MCP-002")
    def test_mcp_access_principals(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Read access-principals")
        resp = api_context.get("/api/mcp/access-principals", headers=H)
        logger.info("access-principals -> %s", resp.status)

        log_test_step("2. Read MCP OAuth config if present")
        resp2 = api_context.get("/api/mcp-oauth", headers=H)
        logger.info("mcp-oauth -> %s", resp2.status)

        log_test_result(test_name, True, 0)
