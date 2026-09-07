# -*- coding: utf-8 -*-
"""
QwenPaw Sessions page object.

Wraps all interactions on the Sessions page and exposes business-level methods.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any
from playwright.sync_api import Page, Locator, expect, TimeoutError

from pages.base_page import BasePage
from config.settings import config


logger = logging.getLogger(__name__)


class SessionsPage(BasePage):
    """
    Sessions page object.

    Wraps all user interactions on the Sessions page:
    - List sessions
    - Filter sessions (UserID/Channel)
    - Sort sessions
    - Edit a session
    - Delete a session
    - Batch delete
    """

    PAGE_TITLE = "QwenPaw Console"
    PAGE_URL = f"{config.base_url}/sessions"

    # ========== Selector definitions ==========

    # Page-loaded indicator (the page has no h1; use the table as the load-complete marker)
    PAGE_LOAD_INDICATOR = '.ant-table, .qwenpaw-table, table'

    # Filter bar
    FILTER_USER_ID_INPUT = 'input[placeholder*="User ID" i], input[placeholder*="用户" i]'
    # Channel filter. Anchored on the component's own class name because the
    # select has no id/name/aria-label/data-placeholder, and both of the
    # previously tried anchors are wrong now:
    #   * '.ant-select[data-placeholder*="Channel" i]' matches nothing -- the
    #     console moved from the antd "ant-" prefix to "qwenpaw-", and the
    #     element carries no data-placeholder attribute at all.
    #   * the '.qwenpaw-select' fallback resolves to 2 elements (an agent
    #     picker first, then the channel filter), so ".first" clicked the
    #     *agent* dropdown and then timed out looking for a "console" option
    #     among Default Agent / QA Agent.
    # '.sessions-filter-select' is unique (count 1) and stays unique after a
    # value is selected, unlike ':has-text("Filter by Channel")' which stops
    # matching once the placeholder text is replaced by the chosen channel.
    FILTER_CHANNEL_SELECT = (
        '.sessions-filter-select, '
        '.ant-select[data-placeholder*="Channel" i], '
        '.qwenpaw-select[data-placeholder*="Channel" i]'
    )
    # Clearing the channel filter. There is no Reset button in this page --
    # 'button:has-text("Reset")' and the Chinese variant both match 0 nodes.
    # The select is rendered with allow-clear, so the clear icon is the real
    # affordance; it only appears once a value is picked and the control is
    # hovered, which reset_filter() below handles.
    FILTER_CLEAR_ICON = '.qwenpaw-select-clear, .ant-select-clear'
    FILTER_CHANNEL_OPTION = '.qwenpaw-select-item-option, .ant-select-option'
    # Kept for backwards compatibility with any caller that still looks for a
    # reset button; the page does not render one.
    FILTER_RESET_BTN = 'button:has-text("Reset"), button:has-text("重置")'

    # Table column header text as rendered, for sort_by_column(). The DOM
    # shows the human-readable header ("CreatedAt"), not the snake_case field
    # name ("created_at") that callers pass in, so sort_by_column maps them.
    SORT_COLUMN_HEADER = '.qwenpaw-table-column-sorters, .ant-table-column-sorters'
    # created_at/updated_at -> rendered header text
    SORTABLE_COLUMN_LABELS = {
        "id": "ID",
        "name": "Name",
        "session_id": "SessionID",
        "sessionid": "SessionID",
        "user_id": "UserID",
        "userid": "UserID",
        "channel": "Channel",
        "created_at": "CreatedAt",
        "createdat": "CreatedAt",
        "updated_at": "UpdatedAt",
        "updatedat": "UpdatedAt",
    }

    # Session table
    SESSION_TABLE = '.ant-table, .qwenpaw-table, table'
    # Data rows only. A rendered antd/qwenpaw table always carries two
    # non-data rows that a bare "tbody tr" selector also matches:
    #   * the column-width measure row (aria-hidden="true")
    #   * the "No data" placeholder row
    # With an empty list the bare selector therefore reports 2 rows, and with
    # 3 real sessions it reports 4 -- so every count built on it was inflated
    # by two. The exclusions below mirror what this suite already does in the
    # ensure_session_data fixture in tests/test_sessions.py.
    SESSION_ROW = (
        '.ant-table-tbody tr:not(.ant-table-measure-row)'
        ':not(.ant-table-placeholder), '
        '.qwenpaw-table-tbody tr:not(.qwenpaw-table-measure-row)'
        ':not(.qwenpaw-table-placeholder), '
        "table tbody tr[data-row-key]"
    )
    SESSION_TABLE_ROW = SESSION_ROW
    SESSION_ROW_SELECTED = '.ant-table-tbody tr.ant-table-row-selected, .qwenpaw-table-tbody tr.qwenpaw-table-row-selected'

    # Table columns
    # The first column is the row-selection checkbox and renders no text, so
    # the data columns start at nth-child(2). The previous 1-based mapping was
    # off by one across the board: SESSION_ID_COL resolved to the empty
    # checkbox cell, so find_session_row() compared against "" and never
    # matched, which made click_edit()/click_delete() raise "Session not
    # found"; get_session_data() returned the UserID as "channel", the
    # Channel as "created_at", and so on. Verified against the live DOM:
    #   th:  '' | ID | Name | SessionID | UserID | Channel | CreatedAt | UpdatedAt | Action
    #   td:  '' | uuid | name | chan:user | user | channel | created | updated | buttons
    SESSION_CHECKBOX_COL = 'td:nth-child(1)'
    SESSION_ID_COL = 'td:nth-child(2)'
    SESSION_NAME_COL = 'td:nth-child(3)'
    SESSION_SESSIONID_COL = 'td:nth-child(4)'
    SESSION_USERID_COL = 'td:nth-child(5)'
    SESSION_CHANNEL_COL = 'td:nth-child(6)'
    SESSION_CREATEDAT_COL = 'td:nth-child(7)'
    SESSION_UPDATEDAT_COL = 'td:nth-child(8)'
    SESSION_ACTION_COL = 'td:nth-child(9)'

    # Action buttons
    # Note: the system under test uses fixed="right" for the Action column in antd Table,
    # which Ant Design splits into a separate "right-fixed shadow table" at render time. The row
    # locator's scope may not directly find these buttons. The selectors below cover, in order:
    # 1) text buttons directly inside the row (best case)
    # 2) look up via the fix-right column (where the fixed column actually lives)
    # 3) Button type="link" small buttons
    EDIT_BTN = (
        'button:has-text("Edit"), button:has-text("编辑"), '
        'a:has-text("Edit"), a:has-text("编辑"), '
        '.qwenpaw-table-cell-fix-right button:has-text("Edit"), '
        '.qwenpaw-table-cell-fix-right button:has-text("编辑"), '
        '.ant-table-cell-fix-right button:has-text("Edit"), '
        '.ant-table-cell-fix-right button:has-text("编辑")'
    )
    DELETE_BTN = (
        'button:has-text("Delete"), button:has-text("删除"), '
        'a:has-text("Delete"), a:has-text("删除"), '
        '.qwenpaw-table-cell-fix-right button:has-text("Delete"), '
        '.qwenpaw-table-cell-fix-right button:has-text("删除"), '
        '.ant-table-cell-fix-right button:has-text("Delete"), '
        '.ant-table-cell-fix-right button:has-text("删除")'
    )
    BATCH_DELETE_BTN = 'button:has-text("Batch Delete"), button:has-text("批量删除")'

    # Pagination
    PAGINATION = '.ant-pagination'
    PAGINATION_NEXT = '.ant-pagination-next'
    PAGINATION_PREV = '.ant-pagination-prev'

    # Edit drawer
    # Anchored on the drawer's content element, not on "[class*=drawer]": that
    # substring matcher resolves to 10 nodes once a drawer is open (the drawer
    # root, mask, content wrapper, content, header, header-title, close, title,
    # body and footer), so expect(...).to_be_visible() fails with a strict-mode
    # violation instead of checking anything.
    # Verified against the live DOM for .qwenpaw-drawer-content:
    #   closed -> 0 nodes, open -> 1 node and visible, Escape -> back to 0,
    # which makes it correct for both to_be_visible() and to_be_hidden().
    SESSION_DRAWER = '.qwenpaw-drawer-content, .ant-drawer-content'
    DRAWER_TITLE = '.qwenpaw-drawer-title, .ant-drawer-title'
    DRAWER_CLOSE = '.ant-drawer-close, .qwenpaw-drawer-close'

    # Form fields
    FORM_NAME_INPUT = 'input[name="name"], input[placeholder*="Name" i], input[placeholder*="名称" i]'
    FORM_USERID_INPUT = 'input[name="user_id"], input[placeholder*="User ID" i], input[placeholder*="用户" i]'
    FORM_CHANNEL_SELECT = '.ant-select[name="channel"], .qwenpaw-select[name="channel"]'
    # Scoped through SESSION_DRAWER instead of a bare "[class*=drawer]" prefix,
    # which matches all 10 drawer sub-elements and can bind the button lookup
    # to the wrong subtree.
    FORM_SUBMIT_BTN = '.qwenpaw-drawer-content button.qwenpaw-btn-primary, .ant-drawer-content button.ant-btn-primary, button:has-text("Save"), button:has-text("保存")'
    FORM_CANCEL_BTN = '.qwenpaw-drawer-content button:has-text("Cancel"), .ant-drawer-content button:has-text("Cancel"), .qwenpaw-drawer-content button:has-text("取消"), button:has-text("Cancel"), button:has-text("取消")'

    # Confirmation dialog
    CONFIRM_MODAL = '.ant-modal, .qwenpaw-modal'
    CONFIRM_OK_BTN = '.ant-modal .ant-btn-primary, .qwenpaw-modal .qwenpaw-btn-primary, button:has-text("OK"), button:has-text("确认"), button:has-text("确定")'
    CONFIRM_CANCEL_BTN = '.ant-modal .ant-btn:not(.ant-btn-primary), .qwenpaw-modal .qwenpaw-btn:not(.qwenpaw-btn-primary), button:has-text("Cancel"), button:has-text("取消")'

    # Empty state
    EMPTY_STATE = '.ant-empty, [class*=empty]'

    # Message toast and loading state (inherited from BasePage; no need to redefine here)

    # ========== Initialization ==========

    def __init__(self, page: Page):
        super().__init__(page)

    # ========== Navigation methods ==========

    def open(self) -> "SessionsPage":
        """Open the Sessions page."""
        logger.info("Opening Sessions page")
        self.goto()
        self.wait_for_page_loaded()
        return self

    def wait_for_page_loaded(self, timeout: Optional[int] = None) -> "SessionsPage":
        """Wait for the page to finish loading."""
        timeout = timeout or self.timeout
        logger.info("Waiting for Sessions page to load")

        # Wait for the table to appear (the page has no h1)
        expect(self.page.locator(self.PAGE_LOAD_INDICATOR).first).to_be_visible(timeout=timeout)

        return self

    # ========== Table operations ==========

    def get_session_rows(self) -> List[Locator]:
        """Get all session rows."""
        return self.page.locator(self.SESSION_ROW).all()

    def get_session_count(self) -> int:
        """Get the number of sessions."""
        return len(self.get_session_rows())

    def find_session_row(self, session_id: str) -> Optional[Locator]:
        """
        Find a session row by session ID.

        Accepts either identifier form the product shows in the table: the
        chat UUID rendered in the ID column, or the "channel:user_id" string
        rendered in the SessionID column. Callers reach for whichever one
        they happened to read first, so matching only one of the two columns
        used to make the lookup silently fail.

        Args:
            session_id: chat UUID or "channel:user_id" session identifier

        Returns:
            Locator of the row; None if not found.
        """
        rows = self.get_session_rows()
        for row in rows:
            try:
                id_cell = row.locator(self.SESSION_ID_COL).first.inner_text()
            except Exception:
                id_cell = ""
            try:
                sid_cell = row.locator(
                    self.SESSION_SESSIONID_COL,
                ).first.inner_text()
            except Exception:
                sid_cell = ""
            if session_id and (session_id in id_cell or session_id in sid_cell):
                return row
        return None

    def find_session_by_name(self, name: str) -> Optional[Locator]:
        """Find a session row by session name."""
        rows = self.get_session_rows()
        for row in rows:
            try:
                name_cell = row.locator(self.SESSION_NAME_COL).first
                if name.lower() in name_cell.inner_text().lower():
                    return row
            except Exception:
                continue
        return None

    def get_session_data(self, row: Locator) -> Dict[str, str]:
        """
        Get the data from a session row.

        Args:
            row: session row Locator

        Returns:
            dict of session fields
        """
        return {
            'id': row.locator(self.SESSION_ID_COL).first.inner_text(),
            'name': row.locator(self.SESSION_NAME_COL).first.inner_text(),
            'session_id': row.locator(self.SESSION_SESSIONID_COL).first.inner_text(),
            'user_id': row.locator(self.SESSION_USERID_COL).first.inner_text(),
            'channel': row.locator(self.SESSION_CHANNEL_COL).first.inner_text(),
            'created_at': row.locator(self.SESSION_CREATEDAT_COL).first.inner_text(),
            'updated_at': row.locator(self.SESSION_UPDATEDAT_COL).first.inner_text(),
        }

    # ========== Filtering ==========

    def filter_by_user_id(self, user_id: str) -> "SessionsPage":
        """Filter by UserID."""
        logger.info(f"Filtering by user_id: {user_id}")
        self.page.locator(self.FILTER_USER_ID_INPUT).first.fill(user_id)
        self.wait_for_loading()
        return self

    def filter_by_channel(self, channel: str) -> "SessionsPage":
        """Filter by Channel.

        Opens the channel select and picks *channel* from its options. Raises
        if the control or the option cannot be driven, so callers cannot
        mistake a stale selector for a passing step.
        """
        logger.info(f"Filtering by channel: {channel}")
        select = self.page.locator(self.FILTER_CHANNEL_SELECT).first
        select.click(timeout=self.timeout)
        option = self.page.locator(self.FILTER_CHANNEL_OPTION).filter(
            has_text=channel,
        ).first
        option.click(timeout=self.timeout)
        self.wait_for_loading()
        selected = select.inner_text(timeout=self.timeout)
        if channel not in selected:
            raise AssertionError(
                f"channel filter did not take effect: expected {channel!r} "
                f"in the select, got {selected!r}"
            )
        logger.info(f"Channel filter applied: {selected.strip()[:40]}")
        return self

    def reset_filter(self) -> "SessionsPage":
        """Clear the channel filter.

        There is no Reset button on this page. The select is rendered with
        allow-clear, so the way back to the unfiltered state is the clear
        icon, which only shows up while a value is selected and the control
        is hovered. Falls back to a real Reset button if the UI ever grows
        one again.
        """
        logger.info("Clearing channel filter")
        select = self.page.locator(self.FILTER_CHANNEL_SELECT).first
        select.hover(timeout=self.timeout)
        clear_icon = select.locator(self.FILTER_CLEAR_ICON).first
        if clear_icon.count() == 0:
            # Nothing selected, or the affordance changed. A real Reset
            # button would be the only other way out.
            legacy = self.page.locator(self.FILTER_RESET_BTN).first
            if legacy.count() > 0:
                legacy.click(timeout=self.timeout)
                self.wait_for_loading()
                return self
            raise AssertionError(
                "no clear icon on the channel filter and no Reset button: "
                "cannot reset the filter"
            )
        clear_icon.click(timeout=self.timeout, force=True)
        self.wait_for_loading()
        remaining = select.inner_text(timeout=self.timeout)
        logger.info(f"Filter cleared, select now shows: {remaining.strip()[:40]}")
        return self

    # ========== Sorting ==========

    def sort_by_column(self, column_name: str) -> "SessionsPage":
        """Sort by a table column and verify the header reports a sort state.

        Args:
            column_name: either the rendered header text ("CreatedAt") or the
                underlying field name callers naturally reach for
                ("created_at"). Field names are mapped through
                SORTABLE_COLUMN_LABELS because the DOM renders the
                human-readable header, not the snake_case key.
        """
        label = self.SORTABLE_COLUMN_LABELS.get(
            column_name.lower(), column_name,
        )
        logger.info(f"Sorting by {column_name} (header label {label!r})")
        sorter = self.page.locator(self.SORT_COLUMN_HEADER).filter(
            has_text=label,
        ).first
        sorter.click(timeout=self.timeout)
        self.wait_for_loading()
        header = self.page.locator("th").filter(has_text=label).first
        direction = header.get_attribute("aria-sort")
        if not direction or direction == "none":
            raise AssertionError(
                f"sorting by {label!r} did not take effect: aria-sort is "
                f"{direction!r}"
            )
        logger.info(f"Sorted by {label}: aria-sort={direction}")
        return self

    # ========== Edit session ==========

    def click_edit(self, session_id: str) -> "SessionsPage":
        """
        Click the edit button.

        Args:
            session_id: session ID
        """
        logger.info(f"Clicking edit for session: {session_id}")
        row = self.find_session_row(session_id)
        if row:
            row.locator(self.EDIT_BTN).first.click()
            self.wait_for_drawer_open()
        else:
            raise Exception(f"Session not found: {session_id}")
        return self

    def wait_for_drawer_open(self, timeout: Optional[int] = None) -> "SessionsPage":
        """Wait for the edit drawer to open."""
        timeout = timeout or self.timeout
        expect(self.page.locator(self.SESSION_DRAWER)).to_be_visible(timeout=timeout)
        return self

    def wait_for_drawer_close(self, timeout: Optional[int] = None) -> "SessionsPage":
        """Wait for the edit drawer to close."""
        timeout = timeout or self.timeout
        expect(self.page.locator(self.SESSION_DRAWER)).to_be_hidden(timeout=timeout)
        return self

    def fill_session_name(self, name: str) -> "SessionsPage":
        """Fill in the session name."""
        self.page.locator(self.FORM_NAME_INPUT).first.fill(name)
        return self

    def fill_session_user_id(self, user_id: str) -> "SessionsPage":
        """Fill in the UserID."""
        self.page.locator(self.FORM_USERID_INPUT).first.fill(user_id)
        return self

    def select_channel(self, channel: str) -> "SessionsPage":
        """Select Channel inside the edit drawer."""
        self.page.locator(self.FORM_CHANNEL_SELECT).first.click()
        # Options render as ".qwenpaw-select-item-option" now; the console
        # moved off the antd "ant-" prefix. Keeping the old selector as a
        # trailing fallback rather than as the only match.
        self.page.locator(self.FILTER_CHANNEL_OPTION).filter(
            has_text=channel,
        ).first.click(timeout=self.timeout)
        return self

    def save_session(self) -> "SessionsPage":
        """Save the session."""
        logger.info("Saving session")
        self.page.locator(self.FORM_SUBMIT_BTN).first.click()
        self.wait_for_loading()
        self.wait_for_success_message()
        self.wait_for_drawer_close()
        return self

    def cancel_session_edit(self) -> "SessionsPage":
        """Cancel editing."""
        logger.info("Canceling session edit")
        self.page.locator(self.FORM_CANCEL_BTN).first.click()
        self.wait_for_drawer_close()
        return self

    # ========== Delete session ==========

    def click_delete(self, session_id: str) -> "SessionsPage":
        """
        Click the delete button.

        Args:
            session_id: session ID
        """
        logger.info(f"Clicking delete for session: {session_id}")
        row = self.find_session_row(session_id)
        if row:
            row.locator(self.DELETE_BTN).first.click()
        else:
            raise Exception(f"Session not found: {session_id}")
        return self

    def confirm_delete(self) -> "SessionsPage":
        """Confirm deletion."""
        logger.info("Confirming delete")
        self.page.locator(self.CONFIRM_OK_BTN).first.click()
        self.wait_for_loading()
        self.wait_for_success_message()
        return self

    def cancel_delete(self) -> "SessionsPage":
        """Cancel deletion."""
        logger.info("Canceling delete")
        self.page.locator(self.CONFIRM_CANCEL_BTN).first.click()
        return self

    # ========== Batch delete ==========

    def select_session(self, session_id: str) -> "SessionsPage":
        """Select a session (for batch operations)."""
        row = self.find_session_row(session_id)
        if row:
            row.locator('input[type="checkbox"]').first.click()
        return self

    def select_all_sessions(self) -> "SessionsPage":
        """Select all sessions."""
        self.page.locator('thead input[type="checkbox"]').first.click()
        return self

    def click_batch_delete(self) -> "SessionsPage":
        """Click the batch delete button."""
        logger.info("Clicking batch delete")
        self.page.locator(self.BATCH_DELETE_BTN).first.click()
        return self

    # ========== Verification ==========

    def verify_session_exists(self, session_id: str) -> bool:
        """Verify the session exists."""
        return self.find_session_row(session_id) is not None

    def verify_session_count(self, expected_count: int) -> bool:
        """Verify the number of sessions."""
        actual_count = self.get_session_count()
        logger.info(f"Session count: {actual_count}, expected: {expected_count}")
        return actual_count == expected_count

    def verify_filter_result(self, expected_count: int) -> bool:
        """Verify the filter result."""
        return self.get_session_count() == expected_count

    def verify_session_data(self, session_id: str, expected_data: Dict[str, str]) -> bool:
        """Verify session data."""
        row = self.find_session_row(session_id)
        if not row:
            return False

        actual_data = self.get_session_data(row)
        for key, expected_value in expected_data.items():
            if key in actual_data and actual_data[key] != expected_value:
                logger.error(f"{key}: expected {expected_value}, got {actual_data[key]}")
                return False

        return True

    def wait_for_success_message(self, timeout: int = 5000) -> bool:
        """Wait for a success message."""
        try:
            expect(self.page.locator(self.SUCCESS_MESSAGE)).to_be_visible(timeout=timeout)
            return True
        except TimeoutError:
            return False

    def wait_for_error_message(self, timeout: int = 5000) -> bool:
        """Wait for an error message."""
        try:
            expect(self.page.locator(self.ERROR_MESSAGE)).to_be_visible(timeout=timeout)
            return True
        except TimeoutError:
            return False

    def wait_for_loading(self, timeout: int = 3000) -> "SessionsPage":
        """Wait for loading to finish."""
        try:
            loading = self.page.locator(self.LOADING_SPINNER)
            if loading.count() > 0:
                expect(loading).to_be_hidden(timeout=timeout)
        except Exception:
            pass
        return self

    def verify_empty_state(self) -> bool:
        """Verify the empty state."""
        try:
            return self.page.locator(self.EMPTY_STATE).first.is_visible()
        except Exception:
            return False