# -*- coding: utf-8 -*-
"""
QwenPaw Files page object.

Wraps all interactions on the Files page and exposes business-level methods.
"""
from __future__ import annotations

import logging
from typing import Optional, List, Dict, Any
from playwright.sync_api import Page, Locator, expect, TimeoutError

from pages.base_page import BasePage
from config.settings import config

logger = logging.getLogger(__name__)


class FilesPage(BasePage):
    """
    Files page object.

    Wraps all user interactions on the Files page:
    - Open the files page
    - Get the file list
    - Get file names and metadata
    - Click a file to open the editor
    - Toggle the file switch
    - Check whether a file is enabled
    """

    PAGE_TITLE = "QwenPaw Console"
    WORKSPACE_URL = f"{config.base_url}/files"
    PAGE_URL = WORKSPACE_URL

    # ========== Selector definitions ==========
    #
    # Re-anchored after the #6504 frontend redesign (2026-08-06). The old
    # ``div[class*="fileItem"]`` family was removed from the console source,
    # so every selector below matched zero elements and the file-list cases
    # silently self-skipped ("No file items found") while still counting as
    # green in the release gate.
    #
    # Verified against the live DOM (port 6266, qwenpaw 2.2.0) on 2026-09-20:
    #   * a Workspace file row is ``<button class*="treeRow">`` holding one
    #     FileGlyph svg + one ``<span>{name}</span>`` -- there is no separate
    #     name/meta sub-element any more, and rows are <button> not <div>;
    #   * directory rows share ``treeRow`` but carry ``aria-expanded``;
    #   * the file enable-switch and drag handle exist ONLY on the Profile
    #     source (``profileRow``), not on Workspace files.

    # Page load indicator: the Files page always renders the source tablist
    # (workspace/profile/daily/digest) and, once a tree is loaded, treeRow(s).
    PAGE_LOAD_INDICATOR = '[role="tab"][data-source], [class*="treeRow"]'

    # Workspace file rows (exclude directories, which carry aria-expanded).
    FILE_ITEM_SELECTOR = '[class*="treeRow"]:not([aria-expanded])'
    DIR_ITEM_SELECTOR = '[class*="treeRow"][aria-expanded]'
    # The file name is the row's own text (button > svg + span); the span is
    # the only text node, so the row's inner_text is the file name.
    FILE_NAME_SELECTOR = 'span'
    # NOTE: there is deliberately no FILE_META_SELECTOR / get_file_meta here.
    # #6504 removed the per-row meta sub-element; a constant that matches zero
    # nodes plus an accessor that silently returns "" is exactly the shape
    # that let the file-list cases self-skip for 45 days while the release
    # gate counted them as green.

    # The enable-switch + drag handle live on the Profile source only.
    PROFILE_TAB_SELECTOR = '[role="tab"][data-source="profile"]'
    WORKSPACE_TAB_SELECTOR = '[role="tab"][data-source="workspace"]'
    PROFILE_ROW_SELECTOR = '[class*="profileRow"]'
    SWITCH_SELECTOR = '[class*="profileRow"] button.qwenpaw-switch[role="switch"]'
    DRAG_HANDLE_SELECTOR = '[class*="profileRow"] [class*="dragHandle"]'

    # ========== Navigation ==========

    def open(self) -> "FilesPage":
        """Open the Files page."""
        logger.info("Opening Files page")
        self.goto()
        self.wait_for_page_loaded()
        return self

    def wait_for_page_loaded(self, timeout: Optional[int] = None) -> "FilesPage":
        """Wait for the page to finish loading."""
        timeout = timeout or self.timeout
        expect(self.page.locator(self.PAGE_LOAD_INDICATOR).first).to_be_visible(timeout=timeout)
        return self

    # ========== File list operations ==========

    def get_file_items(self) -> List[Locator]:
        """Return all file items."""
        items = self.page.locator(self.FILE_ITEM_SELECTOR).all()
        logger.info(f"Found {len(items)} file items")
        return items

    def get_file_name(self, item: Locator) -> str:
        """Return the file name."""
        name_element = item.locator(self.FILE_NAME_SELECTOR).first
        if name_element.count() > 0:
            return name_element.inner_text()
        return ""

    def click_file(self, item: Locator) -> "FilesPage":
        """Click a file to open the editor."""
        item.click()
        logger.info("Clicked file to open editor")
        return self

    def toggle_file_switch(self, item: Locator) -> "FilesPage":
        """Toggle the file enable-switch.

        NOTE: since #6504 the enable-switch only exists on the Profile source
        (system-prompt files), not on Workspace file rows. Callers must switch
        to the Profile tab first; ``item`` should be a ``profileRow`` locator.
        """
        switch = item.locator(self.SWITCH_SELECTOR).first
        if switch.count() > 0:
            switch.click()
            logger.info("Toggled file switch")
        return self

    def is_file_enabled(self, item: Locator) -> bool:
        """Return whether the file is enabled (Profile source switch)."""
        switch = item.locator(self.SWITCH_SELECTOR).first
        if switch.count() > 0:
            return switch.evaluate(
                "el => el.classList.contains('qwenpaw-switch-checked') || "
                "el.getAttribute('aria-checked') === 'true'"
            )
        return False

    # ========== Assertion methods ==========

    def assert_file_count(self, expected_count: int, timeout: Optional[int] = None) -> "FilesPage":
        """Assert the file count."""
        expect(self.page.locator(self.FILE_ITEM_SELECTOR)).to_have_count(
            expected_count, timeout=timeout or self.timeout
        )
        return self

    def assert_file_exists(self, file_name: str, timeout: Optional[int] = None) -> "FilesPage":
        """Assert that the file exists."""
        file_item = self.page.locator(self.FILE_ITEM_SELECTOR).filter(
            has=self.page.locator(self.FILE_NAME_SELECTOR).filter(has_text=file_name)
        ).first
        expect(file_item).to_be_visible(timeout=timeout or self.timeout)
        return self
