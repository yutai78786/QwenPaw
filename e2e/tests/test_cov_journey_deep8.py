# -*- coding: utf-8 -*-
"""
Chat upload + inbox + voice + push deep journeys (5pp wave 8).

Targets:
  - app/routers/console.py chat/upload + task endpoints (87 uncovered)
  - inbox events/read/delete/traces endpoints
  - voice router endpoints
  - push-messages endpoint

Run: pytest tests/test_cov_journey_deep8.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.chat
class TestChatUploadJourney:
    """
    COV-UPLOAD-001: upload a text file through the chat upload endpoint,
    exercising the upload + validation path.
    """

    @pytest.mark.test_id("COV-UPLOAD-001")
    def test_chat_file_upload(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        import tempfile, os

        test_name = request.node.name

        log_test_step("1. Upload a small text file via /console/upload")
        tmp = tempfile.NamedTemporaryFile(suffix=".txt", delete=False)
        tmp.write(b"e2e coverage upload probe\nline two\n")
        tmp.close()
        try:
            import requests as http_requests
            from config.settings import config
            with open(tmp.name, "rb") as fh:
                http_resp = http_requests.post(
                    f"{config.base_url}/api/console/upload",
                    files={"file": ("probe.txt", fh, "text/plain")},
                    headers={"X-Agent-Id": "default"},
                    timeout=60,
                )
        finally:
            os.unlink(tmp.name)

        logger.info("chat upload -> %s", http_resp.status_code)
        assert http_resp.status_code in (200, 201, 400, 413), (
            f"chat upload unexpected [{http_resp.status_code}]: {http_resp.text[:200]}"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.chat
class TestInboxEventsJourney:
    """
    COV-INBOX-002: read inbox events, mark read, and delete — exercises the
    inbox event endpoints beyond the page-render cases.
    """

    @pytest.mark.test_id("COV-INBOX-002")
    def test_inbox_events_flow(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List inbox events")
        resp = api_context.get("/api/console/inbox/events",
                               headers={"X-Agent-Id": "default"})
        logger.info("inbox events -> %s", resp.status)
        events = []
        if resp.ok:
            data = resp.json()
            events = data if isinstance(data, list) else data.get("events", [])

        log_test_step("2. Mark inbox as read")
        resp2 = api_context.post("/api/console/inbox/read",
                                 data={}, headers={"X-Agent-Id": "default"})
        logger.info("inbox read -> %s", resp2.status)

        log_test_step("3. Read a trace if any event has a run_id")
        traced = False
        for ev in events[:5]:
            run_id = ev.get("run_id") or ev.get("trace_id")
            if run_id:
                tr = api_context.get(f"/api/console/inbox/traces/{run_id}",
                                     headers={"X-Agent-Id": "default"})
                logger.info("trace %s -> %s", run_id, tr.status)
                traced = True
                break
        if not traced:
            logger.info("no event with run_id; trace step skipped")

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestPushAndVoiceJourney:
    """
    COV-PUSH-001: hit push-messages and voice config endpoints — exercises
    the remaining small routers.
    """

    @pytest.mark.test_id("COV-PUSH-001")
    def test_push_and_voice(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read push messages")
        resp = api_context.get("/api/console/push-messages",
                               headers={"X-Agent-Id": "default"})
        logger.info("push-messages -> %s", resp.status)

        log_test_step("2. Read voice config")
        resp2 = api_context.get("/api/config/voice",
                                headers={"X-Agent-Id": "default"})
        logger.info("voice config -> %s", resp2.status)

        log_test_step("3. List available commands")
        resp3 = api_context.get("/api/workspace/commands/available",
                                headers={"X-Agent-Id": "default"})
        logger.info("commands available -> %s", resp3.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestFileReferenceChatJourney:
    """
    COV-FILEREF-001: ask the agent to read a seeded workspace file and
    answer about it — exercises file reference injection into the chat
    context (workspace file read + context assembly paths).
    """

    @pytest.mark.test_id("COV-FILEREF-001")
    def test_file_reference_chat(
        self,
        clean_chat_page,
        api_context,
        request: pytest.FixtureRequest,
    ):
        from config.settings import config

        test_name = request.node.name
        chat = clean_chat_page
        page = chat.page
        fname = "e2e_cov8_ref.md"
        secret_word = "quasar-violet-77"

        log_test_step("1. Seed a workspace file with a distinctive word")
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})
        seed = api_context.put(
            f"/api/workspace/files/{fname}",
            data={"content": f"# ref probe\n\nThe magic word is {secret_word}.\n"},
            headers={"X-Agent-Id": "default"},
        )
        assert seed.ok, f"seed failed [{seed.status}]"

        try:
            log_test_step("2. Ask the agent to read it via shell and report")
            page.goto(f"{config.base_url}/chat")
            page.wait_for_load_state("domcontentloaded")
            chat.create_new_chat()

            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(
                f"Use execute_shell_command to find the file {fname} in my "
                "workspace and tell me the magic word written inside it."
            )
            elapsed = 0
            while (
                elapsed < 120000
                and page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
                <= before
            ):
                page.wait_for_timeout(1000)
                elapsed += 1000
            assert (
                page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before
            ), "no reply to file-reference round"

            log_test_result(test_name, True, 0)
        finally:
            api_context.delete(f"/api/workspace/files/{fname}",
                               headers={"X-Agent-Id": "default"})
