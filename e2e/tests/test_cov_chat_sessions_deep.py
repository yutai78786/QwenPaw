# -*- coding: utf-8 -*-
"""
Deep chat session archive/batch flows for coverage boost (Plan B).

Targets: Chat Console & Session (7,977 uncovered lines) — archive,
batch delete, filter, load flows via sidebar + sessions API.

Run: pytest tests/test_cov_chat_sessions_deep.py -v
"""
from __future__ import annotations

import json
import logging
import time

import pytest

from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.chat
class TestChatSessionArchiveBatchDeep:
    """
    COV-CS-001: Create sessions -> search -> rename -> delete -> verify.

    Coverage: session archive/load, batch operations, sidebar grouping.
    """

    @pytest.mark.test_id("COV-CS-001")
    def test_session_archive_batch_deep(
        self,
        clean_chat_page: ChatPage,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        # Seed through POST /api/chats instead of sending two chat messages.
        # The message-driven setup needed a live LLM round trip per session
        # (2 x wait_for_ai_response(timeout=60000)), which made this the
        # second slowest case in the p1 shard while asserting almost nothing.
        stamp = int(time.time() * 1000)
        names = [f"e2e-cov-cs-{stamp}-{i}" for i in range(3)]
        keyword = f"e2e-cov-cs-{stamp}"
        created_ids = []
        try:
            log_test_step("1. Seed three sessions over the API")
            for idx, name in enumerate(names):
                resp = api_context.post(
                    "/api/chats",
                    data=json.dumps({
                        "name": name,
                        "session_id": f"console:e2e_cov_cs_{stamp}_{idx}",
                        "user_id": f"e2e_cov_cs_{stamp}_{idx}",
                        "channel": "console",
                    }),
                )
                assert resp.ok, (
                    f"cannot seed chat [{resp.status}]: {resp.text()[:200]}"
                )
                created_ids.append(resp.json()["id"])

            log_test_step("2. Open session list and find the seeded ones")
            clean_chat_page.open()
            clean_chat_page.open_session_list()
            count = clean_chat_page.get_session_count()
            logger.info(f"Session count: {count}")
            assert count >= 3, (
                f"expected at least the 3 seeded sessions in the sidebar, "
                f"got {count}"
            )

            log_test_step("3. Search narrows the list to the seeded keyword")
            clean_chat_page.search_sessions(keyword)
            matched = clean_chat_page.get_session_count()
            logger.info(f"Sessions matching {keyword!r}: {matched}")
            assert matched == 3, (
                f"searching for the seeded keyword should leave exactly the "
                f"3 seeded sessions, got {matched}"
            )
            clean_chat_page.clear_session_search()
            restored = clean_chat_page.get_session_count()
            assert restored >= matched, (
                f"clearing the search must not drop rows: "
                f"{restored} < {matched}"
            )

            log_test_step("4. Rename a session and verify the new name shows")
            clean_chat_page.search_sessions(keyword)
            before_names = [
                clean_chat_page.page.locator(
                    clean_chat_page.SESSION_NAME,
                ).nth(i).inner_text(timeout=5000)
                for i in range(clean_chat_page.get_session_count())
            ]
            renamed = f"{keyword}-renamed"
            clean_chat_page.rename_session(0, renamed)
            # rename_session() only logs and returns self when the menu or the
            # inline input is missing, so a bare call proves nothing. Read the
            # sidebar back and require the new name to actually be there.
            after_names = [
                clean_chat_page.page.locator(
                    clean_chat_page.SESSION_NAME,
                ).nth(i).inner_text(timeout=5000)
                for i in range(clean_chat_page.get_session_count())
            ]
            logger.info("names before=%r after=%r", before_names, after_names)
            assert any(renamed in n for n in after_names), (
                f"rename did not take effect: {renamed!r} not in "
                f"{after_names!r} (before was {before_names!r})"
            )

            log_test_step("5. Delete a session and verify the count drops")
            before_delete = clean_chat_page.get_session_count()
            clean_chat_page.delete_session(0)
            clean_chat_page.search_sessions(keyword)
            after_delete = clean_chat_page.get_session_count()
            logger.info(
                "delete: before=%s after=%s", before_delete, after_delete,
            )
            assert after_delete < before_delete, (
                f"delete_session did not remove anything: "
                f"{before_delete} -> {after_delete}"
            )

            log_test_step("6. Close session list")
            clean_chat_page.clear_session_search()
            clean_chat_page.close_session_list()
        finally:
            # Whatever the assertions above did, do not leave seeded chats
            # behind for the next case.
            for chat_id in created_ids:
                api_context.delete(f"/api/chats/{chat_id}")

        log_test_result(test_name, True, 0)
