# -*- coding: utf-8 -*-
"""
Deep session management flows for coverage boost (Plan B).

Targets: Chat Console & Session (7,977 uncovered lines) — sessions page
filter/sort/edit/archive flows.

Run: pytest tests/test_cov_sessions_deep.py -v
"""
from __future__ import annotations

import json
import logging

import pytest

from pages.sessions_page import SessionsPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.sessions
class TestSessionsDeep:
    """
    COV-SS-001: Sessions list filter/sort/edit flows.

    Coverage: session list API, drawer edit, filter/sort logic.
    """

    @pytest.fixture
    def seeded_sessions(self, api_context):
        """Create chats over the API so the list is never empty.

        POST /api/chats is deterministic (no LLM round trip), unlike the
        ensure_session_data fixture in tests/test_sessions.py which drives
        POST /api/console/chat. Without seeding, the list renders the "No
        data" placeholder and every interaction below would have nothing to
        act on -- which is how this case used to "pass" without testing
        anything.
        """
        created = []
        for idx in range(3):
            resp = api_context.post(
                "/api/chats",
                data=json.dumps({
                    "name": f"e2e-cov-ss-{idx}",
                    "session_id": f"console:e2e_cov_ss_user_{idx}",
                    "user_id": f"e2e_cov_ss_user_{idx}",
                    "channel": "console",
                }),
            )
            assert resp.ok, f"cannot seed chat [{resp.status}]: {resp.text()[:200]}"
            created.append(resp.json()["id"])
        yield created
        for chat_id in created:
            api_context.delete(f"/api/chats/{chat_id}")

    @pytest.mark.test_id("COV-SS-001")
    def test_sessions_filter_sort_edit(
        self,
        sessions_page: SessionsPage,
        api_context,
        seeded_sessions,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Open sessions page")
        sessions_page.open()
        sessions_page.wait_for_page_loaded()

        log_test_step("2. Seeded sessions are listed")
        count = sessions_page.get_session_count()
        logger.info(f"Sessions: {count}")
        assert count >= 3, (
            f"expected at least the 3 seeded sessions, got {count}"
        )

        log_test_step("3. Filter by channel console narrows to console rows")
        sessions_page.filter_by_channel("console")
        filtered = sessions_page.get_session_count()
        logger.info(f"After channel filter: {filtered}")
        assert filtered >= 3, (
            f"all seeded sessions are on the console channel, so the filter "
            f"must keep them: got {filtered}"
        )
        channels = {
            sessions_page.get_session_data(row).get("channel")
            for row in sessions_page.get_session_rows()
        }
        assert channels == {"console"}, (
            f"filtered rows are not all on the console channel: {channels}"
        )

        log_test_step("4. Clear the filter and get the full list back")
        sessions_page.reset_filter()
        cleared = sessions_page.get_session_count()
        logger.info(f"After clearing filter: {cleared}")
        assert cleared >= filtered, (
            f"clearing the filter must not drop rows: {cleared} < {filtered}"
        )

        log_test_step("5. Sort by CreatedAt actually changes the sort state")
        sessions_page.sort_by_column("created_at")
        header = sessions_page.page.locator("th").filter(
            has_text="CreatedAt",
        ).first
        assert header.get_attribute("aria-sort") not in (None, "none"), (
            "CreatedAt header reports no sort direction after sorting"
        )

        log_test_step("6. Open and close the edit drawer for the first session")
        rows = sessions_page.get_session_rows()
        assert rows, "no session rows to open an edit drawer for"
        data = sessions_page.get_session_data(rows[0])
        sid = data.get("session_id") or data.get("id")
        assert sid, f"could not read a session id from the row: {data!r}"
        sessions_page.click_edit(sid)
        sessions_page.wait_for_drawer_open()
        drawer = sessions_page.page.locator(
            '.qwenpaw-drawer-content, .qwenpaw-drawer',
        ).first
        assert drawer.is_visible(), "edit drawer did not become visible"
        sessions_page.page.keyboard.press("Escape")
        sessions_page.wait_for_drawer_close()

        log_test_result(test_name, True, 0)
