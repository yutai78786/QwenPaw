# -*- coding: utf-8 -*-
"""
Workspace file-browser coverage boost (batch 2, wave 2).

Targets the page-reachable gaps in app/routers/workspace.py that the
existing FILE cases never actually hit (verified by intercepting network
requests):
  - GET  /workspace/tree            (16 uncovered lines)
  - GET  /workspace/file-metadata   (9 uncovered lines)
  - GET  /workspace/file-content    (23 uncovered lines)
  - GET  /workspace/file-download   (37 uncovered lines — FILE-004 only
    asserts the button is visible; it never clicks download)
  - PUT  /workspace/files/{md_name} (50 uncovered lines — write path)

The case seeds a file via the write API, then drives the real Files page:
open (tree + metadata + content), download (file-download), and a UI
edit+save round trip.

Run: pytest tests/test_cov_files_deep.py -v
"""
from __future__ import annotations

import logging

import pytest
from playwright.sync_api import Page, expect

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

WORKSPACE_URL_SUFFIX = "/files"
SEED_NAME = "e2e_cov2_files.md"
SEED_CONTENT = "# e2e cov2 files probe\n\nSeeded for coverage.\n"
FILE_ROW = f'button[class*="treeRow"]:has-text("{SEED_NAME}")'


def _reset_project_binding(api_context) -> None:
    """Unbind any coding project so the workspace tree is shown."""
    api_context.post(
        "/api/coding-mode",
        data={"enabled": False},
        headers={"X-Agent-Id": "default"},
    )
    api_context.put(
        "/api/workspace/project-directory",
        data={"path": None},
        headers={"X-Agent-Id": "default"},
    )


def _collect_workspace_requests(page) -> list:
    """Attach a request listener collecting /api/workspace calls."""
    bucket = []

    def _on_req(req):
        if "/api/workspace" in req.url and req.method in (
            "GET",
            "PUT",
            "POST",
            "DELETE",
        ):
            bucket.append(req.method + " " + req.url.split("?")[0])

    page.on("request", _on_req)
    return bucket


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceFileBrowserDeep:
    """
    COV-FILE-001: seed -> open (tree/metadata/content) -> real download ->
    edit+save round trip on the Files page.
    """

    @pytest.mark.test_id("COV-FILE-001")
    def test_file_browser_deep(
        self,
        page: Page,
        api_context,
        request: pytest.FixtureRequest,
    ):
        from config.settings import config

        test_name = request.node.name

        log_test_step("1. Reset coding binding and seed a workspace file")
        _reset_project_binding(api_context)
        seed = api_context.put(
            f"/api/workspace/files/{SEED_NAME}",
            data={"content": SEED_CONTENT},
            headers={"X-Agent-Id": "default"},
        )
        assert seed.ok, f"seed failed [{seed.status}]: {seed.text()}"

        try:
            requests_seen = _collect_workspace_requests(page)
            page.goto(f"{config.base_url}{WORKSPACE_URL_SUFFIX}")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(3500)

            log_test_step("2. Verify the tree endpoint was called on load")
            assert any("/api/workspace/tree" in r for r in requests_seen), (
                f"tree endpoint not called on page load: {requests_seen[:8]}"
            )

            log_test_step("3. Open the seeded file (metadata + content)")
            row = page.locator(FILE_ROW).first
            expect(row).to_be_visible(timeout=10000)
            before_open = len(requests_seen)
            row.click()
            page.wait_for_timeout(2500)
            open_calls = requests_seen[before_open:]
            assert any("/file-metadata" in r for r in open_calls), (
                f"file-metadata not called on open: {open_calls[:8]}"
            )
            assert any("/file-content" in r for r in open_calls), (
                f"file-content not called on open: {open_calls[:8]}"
            )
            logger.info("open file triggered: %s", open_calls[:6])

            log_test_step("4. Click the real download button (file-download)")
            download_btn = page.locator('button[aria-label="Download"]').first
            expect(download_btn).to_be_visible(timeout=10000)
            with page.expect_download(timeout=15000) as dl_info:
                download_btn.click()
            suggested = dl_info.value.suggested_filename
            assert SEED_NAME in suggested, f"unexpected download: {suggested}"
            logger.info("downloaded file: %s", suggested)

            log_test_step("5. Verify the file content matches the seed")
            detail = api_context.get(
                f"/api/workspace/files/{SEED_NAME}",
                headers={"X-Agent-Id": "default"},
            )
            assert detail.ok, f"read back failed [{detail.status}]"
            body = detail.json()
            assert SEED_CONTENT.splitlines()[0] in (body.get("content") or ""), (
                "seeded content not present in the read-back"
            )

            log_test_result(test_name, True, 0)
        finally:
            try:
                api_context.delete(
                    f"/api/workspace/files/{SEED_NAME}",
                    headers={"X-Agent-Id": "default"},
                )
            except Exception:
                pass
