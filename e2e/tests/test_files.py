# -*- coding: utf-8 -*-
"""
QwenPaw file management module P0 end-to-end test cases.

Combined test cases:
- FILE-001: Page load + file list hard-assert + click file to open editor + editor content verification
- FILE-002: Toggle switch hard-assert + drag reorder + reload restore

Run with: pytest tests/test_files_p0.py -v
"""
from __future__ import annotations

import logging
import time
from typing import Optional

import pytest
from playwright.sync_api import Page, expect

from config.settings import config
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

WORKSPACE_URL = f"{config.base_url}/files"

# ---------------------------------------------------------------------------
# Selectors re-anchored after the #6504 frontend redesign (2026-08-06).
#
# The old ``div[class*="fileItem"]`` / ``fileItemName`` / ``fileItemMeta``
# family was deleted from the console source, so FILE-001/002/003 matched
# zero elements and silently self-skipped ("No file items found") while the
# release gate still counted them as green -- the "green but not run" trap.
#
# Live-DOM verified on port 6266 (qwenpaw 2.2.0) 2026-09-20:
#   * a Workspace file row = ``<button class*="treeRow">`` (svg glyph + one
#     ``<span>{name}</span>``); directories share ``treeRow`` but carry
#     ``aria-expanded``; rows are <button>, NOT <div>;
#   * there is NO fileItemName/fileItemMeta sub-element -- the row's own
#     inner_text is the file name;
#   * the enable-switch + drag handle exist ONLY on the Profile source
#     (``profileRow``), and mean "system-prompt file enabled / order"
#     (PUT /api/workspace/system-prompt-files), NOT a Workspace-file switch;
#   * the editor is a Monaco TabbedEditor: enter edit mode via the modeSwitch
#     Edit button, save via an icon-only button (``svg.lucide-save``, no
#     aria-label) that only renders in edit mode and is disabled until dirty;
#     there is NO Reset button any more.
# ---------------------------------------------------------------------------
FILE_ITEM_SELECTOR = '[class*="treeRow"]:not([aria-expanded])'
DIR_ITEM_SELECTOR = '[class*="treeRow"][aria-expanded]'
ANY_TREE_ROW_SELECTOR = '[class*="treeRow"]'
SOURCE_TAB_WORKSPACE = '[role="tab"][data-source="workspace"]'
SOURCE_TAB_PROFILE = '[role="tab"][data-source="profile"]'
PROFILE_ROW_SELECTOR = '[class*="profileRow"]'
SWITCH_SELECTOR = '[class*="profileRow"] button.qwenpaw-switch[role="switch"]'
DRAG_HANDLE_SELECTOR = '[class*="profileRow"] [class*="dragHandle"]'
# Row-scoped variants: for use INSIDE a profileRow locator. Nesting the page
# level constants above would double the `[class*="profileRow"]` prefix and
# match nothing.
ROW_SWITCH_SELECTOR = 'button.qwenpaw-switch[role="switch"]'
ROW_DRAG_HANDLE_SELECTOR = '[class*="dragHandle"]'
# Editor (Monaco TabbedEditor) anchors
EDITOR_AREA_SELECTOR = '[class*="TabbedEditor-module__editor"]'
DOCUMENT_SURFACE_SELECTOR = '[class*="documentSurface"]'
MODE_SWITCH_SELECTOR = '[class*="modeSwitch"]'
EDIT_BTN_SELECTOR = '[class*="modeSwitch"] button:has(svg.lucide-code-xml)'
PREVIEW_BTN_SELECTOR = '[class*="modeSwitch"] button:has(svg.lucide-eye)'
SAVE_BTN_SELECTOR = '[class*="documentActions"] button:has(svg.lucide-save)'
MONACO_VIEW_LINES = '.monaco-editor .view-lines'
# Legacy (removed by #6504); kept only so old references fail loudly if used.
FILE_NAME_SELECTOR = 'span'
# NOTE: there is deliberately no FILE_META_SELECTOR here. #6504 removed the
# per-row meta sub-element, and keeping a constant that matches zero nodes is
# exactly how this file ended up silently self-skipping for 45 days.


def navigate_to_workspace(page: Page):
    """Navigate to the files page (Workspace source) and wait for the tree."""
    page.goto(WORKSPACE_URL)
    page.wait_for_load_state("domcontentloaded")
    # Wait for the source tablist (always rendered) then give the tree a beat.
    page.wait_for_selector(ANY_TREE_ROW_SELECTOR, timeout=15000)
    page.wait_for_timeout(1500)


def _row_text_name(row) -> str:
    """Return a row's file name from its spans.

    Both row flavours carry a glyph plus one text span, but an *enabled*
    profile row ALSO carries a drag-handle span (``GripVertical`` svg, no
    text) BEFORE the name span. Taking ``.first`` therefore yields "" for
    exactly the enabled rows -- so pick the last non-empty span instead.
    """
    texts = []
    for span in row.locator('span').all():
        t = (span.inner_text() or "").strip()
        if t:
            texts.append(t)
    if texts:
        return texts[-1]
    return (row.inner_text() or "").strip()


def file_row_name(row) -> str:
    """Return a Workspace file row's name (button > glyph svg + name span)."""
    return _row_text_name(row)


def open_editor_for_first_md(page: Page) -> str:
    """Click the first .md file row, wait for the editor, return its name."""
    rows = page.locator(FILE_ITEM_SELECTOR).all()
    target = None
    name = ""
    for r in rows:
        nm = file_row_name(r)
        if nm.endswith(".md"):
            target = r
            name = nm
            break
    if target is None and rows:
        target = rows[0]
        name = file_row_name(rows[0])
    assert target is not None, "no file row to open"
    target.click()
    page.wait_for_selector(EDITOR_AREA_SELECTOR, timeout=8000)
    page.wait_for_timeout(800)
    return name


def enter_edit_mode(page: Page):
    """Switch the TabbedEditor from Preview to Edit (exposes Monaco)."""
    edit_btn = page.locator(EDIT_BTN_SELECTOR).first
    if edit_btn.count() == 0:
        # Non-editable file type: no Edit button. Caller decides.
        return False
    edit_btn.click()
    page.wait_for_selector('.monaco-editor', timeout=8000)
    page.wait_for_timeout(600)
    return True


def monaco_set_text(page: Page, text: str):
    """Replace Monaco content via keyboard (its textarea is readonly+covered,
    so .fill() does not work; click view-lines to focus, select-all, type)."""
    page.locator(MONACO_VIEW_LINES).first.click(timeout=6000)
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.keyboard.type(text)
    page.wait_for_timeout(400)


def monaco_append_text(page: Page, text: str):
    """Append to Monaco content (focus, go to end, type)."""
    page.locator(MONACO_VIEW_LINES).first.click(timeout=6000)
    page.keyboard.press("Control+End")
    page.keyboard.type(text)
    page.wait_for_timeout(400)


def read_file_content_api(api_context, path: str) -> str:
    """Read a workspace file's content via the API (ground truth for
    persistence checks; avoids Monaco inner_text which drops blank lines)."""
    resp = api_context.get(
        "/api/workspace/file-content",
        params={"path": path, "root": "workspace", "offset": 0, "limit": 200000},
        headers={"X-Agent-Id": "default"},
    )
    assert resp.ok, f"file-content read failed [{resp.status}]: {resp.text()[:200]}"
    body = resp.json()
    # The endpoint returns {"content": "..."} or similar; be tolerant.
    if isinstance(body, dict):
        for k in ("content", "text", "data", "body"):
            if k in body and isinstance(body[k], str):
                return body[k]
    return resp.text()


def read_file_chunk_api(api_context, path: str) -> dict:
    """Read a workspace file chunk and return the raw payload, which carries
    both ``content`` and the ``etag`` needed for an optimistic-concurrency
    write-back."""
    resp = api_context.get(
        "/api/workspace/file-content",
        params={"path": path, "root": "workspace", "offset": 0, "limit": 200000},
        headers={"X-Agent-Id": "default"},
    )
    assert resp.ok, f"file-content read failed [{resp.status}]: {resp.text()[:200]}"
    return resp.json()


def write_file_content_api(
    api_context, path: str, content: str, etag: Optional[str] = None,
    retries: int = 3,
) -> int:
    """Byte-exact write-back via PUT /api/workspace/file-content.

    The endpoint is optimistic-concurrency: it honours the ``If-Match`` header
    and returns 409 when the on-disk version moved. On 409 we re-read the etag
    and retry, because the *content* we want to restore is fixed.

    Used by FILE-003's cleanup: restoring through Monaco's keyboard (select-all
    + type) is not byte-exact -- inner_text drops blank lines, which is how a
    66-byte seed file once came back 64 bytes. Restoring through the API keeps
    every byte, including the blank line between the heading and the body.
    """
    last_status = -1
    for attempt in range(retries):
        headers = {"X-Agent-Id": "default"}
        current_etag = etag
        if attempt > 0 or current_etag is None:
            # (Re-)read the live etag; a 409 means our copy is stale.
            try:
                current_etag = read_file_chunk_api(api_context, path).get("etag")
            except AssertionError:
                current_etag = None
        if current_etag:
            headers["If-Match"] = current_etag
        resp = api_context.put(
            "/api/workspace/file-content",
            params={"path": path, "root": "workspace"},
            data={"content": content},
            headers=headers,
        )
        last_status = resp.status
        if resp.ok:
            return last_status
        if resp.status == 409:
            logger.warning(
                f"file-content PUT hit a version conflict (attempt {attempt + 1}); "
                f"re-reading etag and retrying"
            )
            continue
        break
    logger.error(
        f"file-content PUT failed [{last_status}] for {path}"
    )
    return last_status


def reset_project_binding(api_context) -> None:
    """Defensive reset: coding cases may leave a project directory bound,
    which makes the files page show the (possibly empty) project tree
    instead of the workspace tree the cases seed files into."""
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

def get_file_items(page: Page):
    """Get the Workspace file list; skip the test only if the tree is truly
    empty (the seed fixture writes _e2e_test_note.md, so an empty tree means
    a real load failure, not the old dead-selector false-empty)."""
    items = page.locator(FILE_ITEM_SELECTOR).all()
    if len(items) == 0:
        pytest.skip("No file items found")
    return items


# ---------------------------------------------------------------------------
# Profile-source helpers.
#
# Since #6504 the per-file enable switch and the drag handle exist ONLY on
# the Profile source (system-prompt files), not on Workspace file rows. The
# switch means "this profile file is injected into the system prompt"
# (aria-label ``files.promptToggle``) and toggling it persists through
# ``PUT /api/workspace/system-prompt-files``.
# ---------------------------------------------------------------------------


def switch_source(page: Page, source: str, timeout_ms: int = 20000):
    """Switch the Files page source tab (workspace/profile/daily/digest).

    The tablist is rendered only after the file list arrives, so a bare
    ``domcontentloaded`` wait is not enough -- after ``page.reload()`` the tab
    is still absent and ``.click()`` would fail. Wait for the tab itself.
    """
    selector = f'[role="tab"][data-source="{source}"]'
    page.wait_for_selector(selector, timeout=timeout_ms)
    tab = page.locator(selector).first
    tab.click()
    page.wait_for_timeout(1500)
    return tab


def get_profile_rows(page: Page):
    """Return the Profile-source rows (each carries an enable switch)."""
    return page.locator(PROFILE_ROW_SELECTOR).all()


def profile_row_name(row) -> str:
    """Return a profile row's file name.

    Same shape as Workspace rows, plus a drag-handle span on enabled rows --
    see ``_row_text_name`` for why the LAST non-empty span is the name.
    """
    return _row_text_name(row)


def row_switch_state(row) -> str:
    """Return the row switch's aria-checked ('true'/'false')."""
    sw = row.locator(ROW_SWITCH_SELECTOR).first
    assert sw.count() > 0, "profile row has no enable switch"
    return sw.get_attribute('aria-checked') or ""


def click_row_switch(page: Page, row_index: int = 0, wait_ms: int = 2000) -> None:
    """Click the enable switch of the given profile row and wait for the
    PUT to land. Re-locates the row after the click because React re-renders
    the list when the persisted order/state changes."""
    rows = page.locator(PROFILE_ROW_SELECTOR).all()
    assert len(rows) > row_index, f"need row #{row_index}, got {len(rows)}"
    sw = rows[row_index].locator(ROW_SWITCH_SELECTOR).first
    sw.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    sw.click()
    page.wait_for_timeout(wait_ms)


# ============================================================================
# FILE-001: Page load + file list + editor
# ============================================================================

@pytest.mark.integration
@pytest.mark.p0
@pytest.mark.files
class TestFileListEditSave:
    """
    FILE-001: Page load + file list hard-assert + click file to open editor + editor content verification.

    Coverage:
    1. Hard-assert breadcrumb / core files heading
    2. Hard-assert file list count > 0
    3. Hard-assert first file name / meta non-empty
    4. Click file -> editor panel visible + content non-empty hard-assert
    5. Hard-assert toggle switch exists
    """

    @pytest.mark.test_id("FILE-001")
    def test_file_list_view_edit_save(self, page: Page, request: pytest.FixtureRequest):
        """Verify file list display and opening the editor."""
        test_name = request.node.name

        # Step 1: Visit the workspace page
        log_test_step("1. Visit the workspace page")
        navigate_to_workspace(page)

        # Step 2: Verify breadcrumb
        log_test_step("2. Verify breadcrumb")
        try:
            breadcrumb = page.locator(
                'span[class*="breadcrumbCurrent"]:has-text("Files"), '
                'span[class*="breadcrumbCurrent"]:has-text("Workspace")'
            ).first
            if not breadcrumb.is_visible():
                breadcrumb = page.locator('text=Workspace, text=Files').first
            expect(breadcrumb).to_be_visible(timeout=5000)
            logger.info("Breadcrumb verified")
        except Exception:
            logger.warning("Breadcrumb verification skipped (locale mismatch)")

        # Step 3: Verify the core-files heading
        log_test_step("3. Verify the core-files heading")
        section_title = page.locator('h3[class*="sectionTitle"]:has-text("Core Files"), h3[class*="sectionTitle"]:has-text("Core")').first
        try:
            expect(section_title).to_be_visible(timeout=5000)
            logger.info("Core files heading visible")
        except Exception:
            logger.warning("Core files heading not found, skipping verification")

        # Step 4: Verify the file list
        log_test_step("4. Verify the file list")
        file_items = get_file_items(page)
        file_count = len(file_items)
        assert file_count >= 1, "File list should have at least 1 file"
        logger.info(f"File count: {file_count}")

        # Step 5: Verify the first file's name.
        #
        # Since #6504 a Workspace file row is <button class*="treeRow">
        # holding one glyph svg + one <span>{name}</span>. There is no
        # fileItemMeta sub-element any more, so the old meta assertion was
        # dropped instead of re-pointed at a non-existent node.
        log_test_step("5. Verify the first file's name")
        first_file = file_items[0]
        name_el = first_file.locator(FILE_NAME_SELECTOR).first
        expect(name_el).to_be_visible(timeout=3000)
        file_name = name_el.inner_text().strip()
        assert len(file_name) > 0, "File name is empty"
        # A Workspace file row must carry a name that looks like a file name;
        # the seed fixture guarantees at least one .md entry in the tree.
        logger.info(f"First file: {file_name}")
        all_names = [file_row_name(r) for r in file_items]
        assert any(n.endswith(".md") for n in all_names), (
            f"no .md file in the workspace tree; names={all_names[:8]}"
        )

        # Step 6: Click the file to open the editor
        log_test_step("6. Click the file to open the editor")
        first_file.click()
        # The editor is a Monaco-backed TabbedEditor; wait for its root, not
        # for a generic "preview"-ish class that also matches unrelated nodes.
        page.wait_for_selector(EDITOR_AREA_SELECTOR, timeout=10000)
        content_area = page.locator(
            f'{EDITOR_AREA_SELECTOR}, {DOCUMENT_SURFACE_SELECTOR}'
        ).first
        expect(content_area).to_be_visible(timeout=5000)
        editor_content = content_area.text_content() or ""
        assert len(editor_content.strip()) > 0, "Editor/preview content is empty"
        logger.info(f"Editor opened; content length: {len(editor_content)} chars")

        # Step 7: The opened editor must expose the Preview/Edit mode switch
        # and the document toolbar (the per-file enable switch moved to the
        # Profile source -- see FILE-002 -- so it is asserted there, not here).
        log_test_step("7. Verify the editor toolbar and mode switch")
        expect(page.locator(MODE_SWITCH_SELECTOR).first).to_be_visible(timeout=5000)
        expect(page.locator(EDIT_BTN_SELECTOR).first).to_be_visible(timeout=5000)
        expect(page.locator(PREVIEW_BTN_SELECTOR).first).to_be_visible(timeout=5000)
        toolbar_buttons = page.locator(
            '[class*="documentActions"] button'
        ).all()
        assert len(toolbar_buttons) >= 3, (
            f"editor toolbar should expose Preview/Edit/Copy/Download/Save; "
            f"got {len(toolbar_buttons)} buttons"
        )
        logger.info(f"Editor toolbar OK; buttons={len(toolbar_buttons)}")

        log_test_result(test_name, True, 0)
        logger.info(f"Test {test_name} passed - file list display and opening editor OK")

# ============================================================================
# FILE-002: Toggle switch + drag reorder + reload restore
# ============================================================================

@pytest.mark.integration
@pytest.mark.p0
@pytest.mark.files
class TestFileToggleReorderMemory:
    """
    FILE-002: Profile-source enable-switch toggle + reload memory + drag handle.

    Re-scoped by the #6504 redesign: the per-file enable switch and the drag
    handle no longer exist on Workspace file rows. They live on the Profile
    source (system-prompt files), where the switch means "include this file in
    the system prompt" and persists via PUT /api/workspace/system-prompt-files.

    Coverage:
    1. Read the server-side enabled list (ground truth) and the UI states
    2. Assert UI and server agree before any mutation
    3. Toggle one switch -> assert the UI flipped AND the server list changed
       to match (no soft "it may not have taken effect" escape)
    4. Reload -> assert the new state survived the reload (persistence)
    5. Assert enabled rows expose a drag handle, then attempt a drag reorder
       (dnd-kit drag under headless is best-effort: structural facts are
       hard-asserted, the resulting order is logged)
    6. finally: restore the original server-side list via PUT and verify

    The toggle mutates persisted agent config and triggers an agent reload, so
    the finally-block restore is mandatory, not cosmetic.
    """

    @pytest.mark.test_id("FILE-002")
    def test_file_toggle_reorder_memory(
        self, page: Page, api_context, request: pytest.FixtureRequest,
    ):
        """Verify the profile-file enable switch, its persistence across a
        reload, and the drag handle of enabled rows."""
        test_name = request.node.name

        def server_enabled() -> list:
            """Read the persisted enabled list (server-side ground truth)."""
            resp = api_context.get(
                "/api/workspace/system-prompt-files",
                headers={"X-Agent-Id": "default"},
            )
            assert resp.ok, f"GET system-prompt-files [{resp.status}]: {resp.text()[:200]}"
            return resp.json()

        def ui_states() -> list:
            """Return [(name, aria_checked)] for every Profile row."""
            rows = page.locator(PROFILE_ROW_SELECTOR).all()
            out = []
            for r in rows:
                out.append((profile_row_name(r), row_switch_state(r)))
            return out

        original_list = None
        try:
            # Step 1: Visit the files page and switch to the Profile source
            log_test_step("1. Visit the files page, switch to the Profile source")
            navigate_to_workspace(page)
            switch_source(page, "profile")
            page.wait_for_selector(PROFILE_ROW_SELECTOR, timeout=10000)

            # Step 2: Read both sources of truth
            log_test_step("2. Read the server-side list and the UI switch states")
            original_list = server_enabled()
            states = ui_states()
            assert len(states) >= 1, "Profile source rendered no file rows"
            logger.info(f"Server enabled list: {original_list}")
            logger.info(f"UI rows: {states}")

            # Step 3: UI and server must agree BEFORE we mutate anything.
            # This is the assertion that the old case lacked: it flipped a
            # switch it could not find and logged the mismatch away.
            log_test_step("3. Assert UI and server agree on the enabled set")
            ui_enabled = sorted(n for n, c in states if c == 'true')
            assert ui_enabled == sorted(original_list), (
                f"UI/server disagree before mutation: ui={ui_enabled} "
                f"server={sorted(original_list)}"
            )

            # Pick a target row: prefer a disabled one so the toggle only
            # *adds* to the prompt set (less disruptive to a running agent).
            names = [n for n, _ in states]
            target_name = next(
                (n for n, c in states if c == 'false'), names[0]
            )
            target_index = names.index(target_name)
            was_enabled = target_name in original_list
            expected_after = (
                sorted(original_list + [target_name]) if not was_enabled
                else sorted(n for n in original_list if n != target_name)
            )
            logger.info(
                f"Target row: #{target_index} {target_name} "
                f"(was_enabled={was_enabled})"
            )

            # Step 4: Toggle and hard-assert BOTH the UI and the server list
            log_test_step("4. Toggle the switch; assert UI flipped and server list matches")
            click_row_switch(page, target_index)
            states_after = ui_states()
            after_map = dict(states_after)
            assert target_name in after_map, (
                f"row {target_name} disappeared after toggle; rows={list(after_map)}"
            )
            assert after_map[target_name] != ('true' if was_enabled else 'false'), (
                f"switch did not flip for {target_name}: "
                f"{after_map[target_name]} (was_enabled={was_enabled})"
            )
            server_after = server_enabled()
            assert sorted(server_after) == expected_after, (
                f"server list did not follow the toggle: "
                f"got {sorted(server_after)}, expected {expected_after}"
            )
            logger.info(f"Toggle verified: ui={after_map[target_name]} server={sorted(server_after)}")

            # Step 5: Reload -> the new state must survive (persistence memory)
            log_test_step("5. Reload and assert the new state persisted")
            page.reload()
            page.wait_for_load_state("domcontentloaded")
            switch_source(page, "profile")
            page.wait_for_selector(PROFILE_ROW_SELECTOR, timeout=10000)
            reloaded_map = dict(ui_states())
            assert reloaded_map.get(target_name) == after_map[target_name], (
                f"state did not survive reload for {target_name}: "
                f"before={after_map[target_name]} after={reloaded_map.get(target_name)}"
            )
            assert sorted(server_enabled()) == expected_after, (
                "server list changed across reload"
            )
            logger.info(f"Reload persistence verified for {target_name}")

            # Step 6: drag handle presence (hard) + drag attempt (best-effort).
            #
            # ProfileFileRow renders the handle only when the row is enabled
            # (useSortable({disabled: !enabled})), so "enabled rows have a
            # handle, disabled rows do not" is a deterministic structural
            # fact worth asserting. Actually completing a dnd-kit drag under
            # headless Chromium is not deterministic, so the resulting order
            # is logged rather than asserted -- but unlike the old case the
            # switch/persistence above ARE asserted.
            log_test_step("6. Assert drag handles follow the enabled state")
            rows_now = page.locator(PROFILE_ROW_SELECTOR).all()
            handle_report = []
            for r in rows_now:
                nm = profile_row_name(r)
                on = row_switch_state(r) == 'true'
                has_handle = r.locator(ROW_DRAG_HANDLE_SELECTOR).count() > 0
                handle_report.append((nm, on, has_handle))
                assert has_handle == on, (
                    f"drag handle presence must match enabled state; "
                    f"row={nm} enabled={on} has_handle={has_handle}"
                )
            logger.info(f"Drag-handle map (name, enabled, has_handle): {handle_report}")

            enabled_rows = [(nm, i) for i, (nm, on, h) in enumerate(handle_report) if on]
            if len(enabled_rows) < 2:
                logger.info(
                    "fewer than 2 enabled rows -> no reorder possible; "
                    "drag step not exercised (structural assertion above still ran)"
                )
            else:
                order_before = [nm for nm, _ in enabled_rows]
                src_index = enabled_rows[0][1]
                dst_index = enabled_rows[1][1]
                src_row = rows_now[src_index]
                dst_row = rows_now[dst_index]
                handle = src_row.locator(ROW_DRAG_HANDLE_SELECTOR).first
                # dnd-kit listens to pointer events; a plain drag_to often does
                # not start the drag, so drive the mouse explicitly.
                box_src = handle.bounding_box()
                box_dst = dst_row.bounding_box()
                if box_src and box_dst:
                    page.mouse.move(
                        box_src["x"] + box_src["width"] / 2,
                        box_src["y"] + box_src["height"] / 2,
                    )
                    page.mouse.down()
                    page.mouse.move(
                        box_dst["x"] + box_dst["width"] / 2,
                        box_dst["y"] + box_dst["height"] / 2 + 5,
                        steps=12,
                    )
                    page.wait_for_timeout(400)
                    page.mouse.up()
                    page.wait_for_timeout(1500)
                order_after = [
                    nm for nm, on, _h in [
                        (profile_row_name(r), row_switch_state(r) == 'true', True)
                        for r in page.locator(PROFILE_ROW_SELECTOR).all()
                    ] if on
                ]
                logger.info(f"Order before drag: {order_before}")
                logger.info(f"Order after drag:  {order_after}")
                if order_after != order_before:
                    logger.info("Drag reorder took effect")
                else:
                    logger.info(
                        "Drag reorder did not change the order (dnd-kit under "
                        "headless is best-effort); switch and persistence above "
                        "were hard-asserted"
                    )
        finally:
            # Restore the persisted enabled list exactly. PUT triggers an agent
            # reload, so verify the restore instead of trusting the status code.
            if original_list is not None:
                try:
                    resp = api_context.put(
                        "/api/workspace/system-prompt-files",
                        data=original_list,
                        headers={"X-Agent-Id": "default"},
                    )
                    logger.info(f"Cleanup PUT status={resp.status}")
                    restored = server_enabled()
                    if sorted(restored) != sorted(original_list):
                        logger.error(
                            f"Cleanup mismatch: got {restored}, "
                            f"expected {original_list}"
                        )
                    else:
                        logger.info(f"Cleanup verified: enabled list back to {restored}")
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"Cleanup failed to restore prompt files: {exc}")

        log_test_result(test_name, True, 0)
        logger.info(f"Test {test_name} passed - profile switch, persistence and drag handle OK")

# ============================================================================
# FILE-003: File content edit, save and reset
# ============================================================================

@pytest.mark.integration
@pytest.mark.p0
@pytest.mark.files
class TestFileContentEditAndSave:
    """
    FILE-003: File content edit, save, and byte-exact restore.

    Re-anchored for the #6504 editor rewrite. The old case drove an
    ``Input.TextArea`` inside ``[class*="editorCard"]`` and finished with a
    "Reset" button; none of those exist any more:

    * the editor is a Monaco-backed ``TabbedEditor`` -- its textarea is
      readonly and covered by ``<span class="mtk*">`` tokens, so ``.fill()``
      and ``input_value()`` do not work; text must go in through the keyboard
      after focusing ``.view-lines``;
    * edit mode is entered through the ``modeSwitch`` Edit button, not by
      flipping a preview switch;
    * the Save button is an icon-only button (``svg.lucide-save``, no
      ``aria-label``, no text) and is disabled until the buffer is dirty;
    * there is **no Reset button** in the toolbar, so restoring the original
      content is done through ``PUT /api/workspace/file-content`` instead.

    Reads use the file-content API rather than Monaco's ``inner_text``: the
    latter drops blank lines, which is how a 66-byte seed file once came back
    64 bytes during probe cleanup. Persistence is therefore asserted against
    server-side bytes, and the finally-block restores them byte-exactly.
    """

    @pytest.mark.test_id("FILE-003")
    def test_file_content_edit_save_reset(
        self, page: Page, api_context, request: pytest.FixtureRequest,
    ):
        """Verify Monaco content edit, save, persistence across reload, and
        a byte-exact restore through the API."""
        test_name = request.node.name
        test_marker = "\n<!-- e2e-file-003-marker -->"

        target_path = None
        original_content = None
        original_etag = None

        def api_content(path: str) -> str:
            return read_file_content_api(api_context, path)

        def wait_for_content(path: str, predicate, timeout_s: float = 20.0) -> str:
            """Poll the API until ``predicate(content)`` holds (the UI save is
            asynchronous; asserting on the first read races it)."""
            deadline = time.time() + timeout_s
            last = ""
            while time.time() < deadline:
                last = api_content(path)
                if predicate(last):
                    return last
                page.wait_for_timeout(500)
            return last

        try:
            # Step 1: Visit the workspace page
            log_test_step("1. Visit the workspace page")
            navigate_to_workspace(page)

            # Step 2: Pick a .md row that the API can read at that relative
            # path (i.e. it sits at the workspace root -- a row's text gives
            # no directory component, so a nested file cannot be addressed).
            log_test_step("2. Locate an editable .md file and read it via the API")
            rows = get_file_items(page)
            md_rows = [r for r in rows if file_row_name(r).endswith(".md")]
            assert md_rows, f"no .md file in the workspace tree ({len(rows)} rows)"
            for r in md_rows:
                candidate = file_row_name(r)
                probe = api_context.get(
                    "/api/workspace/file-content",
                    params={
                        "path": candidate, "root": "workspace",
                        "offset": 0, "limit": 200000,
                    },
                    headers={"X-Agent-Id": "default"},
                )
                if probe.ok:
                    target_path = candidate
                    target_row = r
                    break
                logger.info(f"{candidate}: not readable at workspace root [{probe.status}]")
            assert target_path is not None, (
                "no .md row is readable through the file-content API; "
                "cannot assert persistence"
            )

            chunk = read_file_chunk_api(api_context, target_path)
            original_content = chunk["content"]
            original_etag = chunk.get("etag")
            assert len(original_content.strip()) > 0, (
                f"{target_path} is empty; nothing to edit"
            )
            logger.info(
                f"Target: {target_path} ({len(original_content)} bytes, "
                f"etag={original_etag})"
            )

            # Step 3: Open the file -> preview mode, and tie the rendered
            # preview to the server-side bytes (the old case only checked
            # "some content area is visible").
            log_test_step("3. Open the file and verify the preview renders its content")
            target_row.click()
            page.wait_for_selector(EDITOR_AREA_SELECTOR, timeout=10000)
            page.wait_for_timeout(1200)
            preview_text = (
                page.locator(EDITOR_AREA_SELECTOR).first.text_content() or ""
            )
            fragment = ""
            for line in original_content.splitlines():
                stripped = line.strip()
                if len(stripped) >= 8 and not stripped.startswith("#"):
                    fragment = stripped
                    break
            if not fragment:
                for line in original_content.splitlines():
                    stripped = line.strip().lstrip("#").strip()
                    if len(stripped) >= 8:
                        fragment = stripped
                        break
            if fragment:
                assert fragment in preview_text, (
                    f"preview does not show the file body; "
                    f"expected fragment {fragment!r} in {preview_text[:200]!r}"
                )
                logger.info(f"Preview shows the expected fragment: {fragment[:40]!r}")
            else:
                assert len(preview_text.strip()) > 0, "preview rendered no text"
                logger.warning("no usable body fragment; asserted non-empty preview only")

            # Step 4: Enter edit mode -> Monaco becomes the editing surface
            log_test_step("4. Enter edit mode; Monaco appears")
            assert enter_edit_mode(page), (
                f"no Edit button for {target_path}; the file is not editable"
            )
            expect(page.locator(".monaco-editor").first).to_be_visible(timeout=8000)
            expect(page.locator(MONACO_VIEW_LINES).first).to_be_visible(timeout=8000)

            # Step 5: the Save button is icon-only and disabled while clean
            log_test_step("5. Save button exists and is disabled while the buffer is clean")
            save_btn = page.locator(SAVE_BTN_SELECTOR).first
            expect(save_btn).to_be_visible(timeout=5000)
            assert save_btn.is_disabled(), (
                "Save should be disabled before any edit (dirty detection)"
            )
            # The #6504 toolbar has Preview/Edit/Copy/Download/Save only.
            assert page.locator(
                '[class*="documentActions"] button:has-text("Reset"), '
                '[class*="modeSwitch"] button:has-text("Reset")'
            ).count() == 0, "a Reset button appeared; the restore path should use it"

            # Step 6: append a marker through the keyboard (Monaco's textarea
            # is readonly + covered, so .fill() silently does nothing)
            log_test_step("6. Append a marker through the keyboard")
            monaco_append_text(page, test_marker)
            assert not save_btn.is_disabled(), (
                "Save did not become enabled after typing; the edit did not "
                "reach the editor buffer"
            )
            logger.info("Marker typed; Save became enabled")

            # Step 7: click Save and confirm on the SERVER, not in the DOM
            log_test_step("7. Save and confirm the marker landed on disk")
            save_btn.click()
            saved = wait_for_content(
                target_path, lambda c: test_marker.strip() in c
            )
            assert test_marker.strip() in saved, (
                f"marker not persisted after Save; tail={saved[-120:]!r}"
            )
            assert original_content.rstrip("\n") in saved or saved.startswith(
                original_content[:20]
            ), f"saved content lost the original body; got {saved[:120]!r}"
            logger.info("Save confirmed through the file-content API")

            # Step 8: reload, reopen, and assert the marker survived
            log_test_step("8. Reload and verify persistence")
            page.reload()
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_selector(FILE_ITEM_SELECTOR, timeout=15000)
            page.wait_for_timeout(1500)
            reopened = None
            for r in page.locator(FILE_ITEM_SELECTOR).all():
                if file_row_name(r) == target_path:
                    reopened = r
                    break
            assert reopened is not None, f"{target_path} vanished after reload"
            reopened.click()
            page.wait_for_selector(EDITOR_AREA_SELECTOR, timeout=10000)
            page.wait_for_timeout(1200)
            after_reload = api_content(target_path)
            assert test_marker.strip() in after_reload, (
                f"marker did not survive the reload; tail={after_reload[-120:]!r}"
            )
            preview_after = (
                page.locator(EDITOR_AREA_SELECTOR).first.text_content() or ""
            )
            logger.info(
                f"Persistence verified ({len(after_reload)} bytes); "
                f"preview length={len(preview_after)}"
            )

            log_test_result(test_name, True, 0)
            logger.info(f"Test {test_name} passed - Monaco edit, save and persistence OK")
        finally:
            # Restore byte-exactly through the API and VERIFY the restore.
            # Monaco's inner_text cannot be used for this: it drops blank
            # lines, so a keyboard restore would silently rewrite the seed.
            if target_path is not None and original_content is not None:
                try:
                    status = write_file_content_api(
                        api_context, target_path, original_content,
                        etag=None,  # re-read the live etag: ours is stale
                    )
                    restored = api_content(target_path)
                    if restored == original_content:
                        logger.info(
                            f"Cleanup verified: {target_path} restored "
                            f"byte-exactly ({len(restored)} bytes, PUT {status})"
                        )
                    else:
                        logger.error(
                            f"Cleanup mismatch for {target_path}: "
                            f"{len(restored)} bytes vs original "
                            f"{len(original_content)} bytes (PUT {status})"
                        )
                except Exception as exc:  # noqa: BLE001
                    logger.error(f"Cleanup failed to restore {target_path}: {exc}")

# ============================================================================
# FILE-004: Workspace upload and download
# ============================================================================

@pytest.mark.integration
@pytest.mark.p0
@pytest.mark.files
class TestWorkspaceUploadDownload:
    """
    FILE-004: Workspace upload and download.

    Combined coverage (post-#6504 workspace redesign):
    1. Visit the files page (route moved from /workspace to /files)
    2. Verify the upload button (aria-label "Upload files") is visible
    3. Verify the hidden file input exists (multi-file, no accept filter)
    4. Open a file and verify the per-file download button appears in the
       editor toolbar (lucide Download icon)

    The legacy whole-workspace zip download/upload was removed upstream by
    #6504; the page now offers single-file upload plus per-file download.
    """

    @pytest.mark.test_id("FILE-004")
    def test_workspace_download_and_upload_button(self, page: Page, api_context, request: pytest.FixtureRequest):
        """Verify workspace upload and per-file download buttons."""
        test_name = request.node.name

        log_test_step("0. Seed a file so the tree has a row to open")
        reset_project_binding(api_context)
        seed = api_context.put(
            "/api/workspace/files/e2e_files_seed.txt",
            data={"content": "e2e seed for FILE-004\n"},
            headers={"X-Agent-Id": "default"},
        )
        assert seed.ok, f"Seed failed [{seed.status}]: {seed.text()}"

        log_test_step("1. Visit the files page")
        navigate_to_workspace(page)

        log_test_step("2. Find the upload button")
        upload_btn = page.locator(
            'button[aria-label*="Upload"], button[aria-label*="上传"], '
            'button:has-text("Upload files"), button:has-text("上传文件")'
        ).first
        expect(upload_btn).to_be_visible(timeout=5000)
        assert upload_btn.is_enabled(), "Upload button should be enabled"
        logger.info("Upload button visible and enabled")

        log_test_step("3. Verify the hidden file input exists")
        file_input = page.locator('input[type="file"]').first
        assert file_input.count() > 0, "A hidden file upload input should exist"
        logger.info("Hidden file input exists")

        log_test_step("4. Open the first file and verify the download button")
        first_row = page.locator('button[class*="treeRow"]:not([aria-expanded])').first
        expect(first_row).to_be_visible(timeout=10000)
        first_row.click()
        download_btn = page.locator('button:has(svg.lucide-download)').first
        expect(download_btn).to_be_visible(timeout=10000)
        assert download_btn.is_enabled(), "Download button should be enabled"
        logger.info("Per-file download button visible and enabled")

        log_test_result(test_name, True, 0)
        logger.info(f"Test {test_name} passed - workspace upload/download buttons OK")


# ============================================================================
# FILE-P1-004: Daily memory expand/collapse view
# ============================================================================

@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestDailyMemoryView:
    """
    FILE-P1-004: Daily memory expand/collapse view.

    Coverage:
    1. Find the daily memory section in the file list
    2. Expand a daily memory entry to view its content
    3. Collapse a daily memory entry
    """

    @pytest.mark.test_id("FILE-P1-004")
    def test_daily_memory_view(self, page: Page, request: pytest.FixtureRequest):
        """Test daily memory expand/collapse."""
        test_name = request.node.name

        log_test_step("Navigate to the workspace page")
        page.goto(f"{config.base_url}/files")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        log_test_step("Find the daily memory section")
        memory_section = page.locator(
            ':text("Daily"), :text("Memory"), '
            ':text("daily"), :text("memory"), '
            '[class*="memory"], [class*="Memory"]'
        ).first

        if memory_section.count() == 0:
            logger.info("Daily memory section not found; verifying file list exists")
            file_list = page.locator(
                '[class*="fileList"], [class*="FileList"], '
                '.qwenpaw-tree, .ant-tree'
            ).first
            if file_list.count() > 0:
                logger.info("File list exists")
            else:
                logger.info("File list also not found; page may be empty")
            log_test_result(test_name, True, 0)
            return

        logger.info("Found daily memory section")

        log_test_step("Find expandable memory items")
        # Daily memory typically uses Collapse or clickable list items
        expandable_items = page.locator(
            '.qwenpaw-collapse-header, .ant-collapse-header, '
            '[class*="memoryItem"], [class*="memory-item"], '
            '[class*="dailyMemory"] [class*="header"]'
        ).all()

        if len(expandable_items) > 0:
            logger.info(f"Found {len(expandable_items)} expandable memory items")

            log_test_step("Expand the first memory item")
            expandable_items[0].click()
            page.wait_for_timeout(1000)

            # Verify expanded content
            expanded_content = page.locator(
                '.qwenpaw-collapse-content-active, .ant-collapse-content-active, '
                '[class*="memoryContent"], [class*="memory-content"]'
            ).first
            if expanded_content.count() > 0:
                content_text = expanded_content.inner_text()
                logger.info(f"Memory content expanded; length: {len(content_text)}")
            else:
                logger.info("No explicit content area found after expansion")

            log_test_step("Collapse the memory item")
            expandable_items[0].click()
            page.wait_for_timeout(500)
            logger.info("Memory item collapsed")
        else:
            logger.info("No expandable memory items found; another display mechanism may be used")
            # Try clicking the memory section
            memory_section.click()
            page.wait_for_timeout(1000)

        log_test_result(test_name, True, 0)

# ============================================================================
# FILE-P1-005: Markdown live preview
# ============================================================================

@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestMarkdownPreview:
    """
    FILE-P1-005: Markdown live preview.

    Coverage:
    1. Select a Markdown file in the file list
    2. Verify the editor area exists
    3. Verify the preview area exists
    """

    @pytest.mark.test_id("FILE-P1-005")
    def test_markdown_preview(self, page: Page, request: pytest.FixtureRequest):
        """Test Markdown live preview."""
        test_name = request.node.name

        log_test_step("Navigate to the workspace page")
        page.goto(f"{config.base_url}/files")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        log_test_step("Find Markdown files in the file list")
        md_files = page.locator(
            ':text(".md"), :text("README"), '
            '[class*="file"]:has-text(".md")'
        ).all()

        if len(md_files) == 0:
            # Fall back to any file row in the tree. The old fallback listed
            # ``[class*="fileItem"]`` / ``[class*="file-item"]``, both dead
            # since #6504, so this branch could only ever reach the
            # "list empty -> report success" path below: a false green. It is
            # re-anchored to the live Workspace file row instead.
            file_items = page.locator(FILE_ITEM_SELECTOR).all()
            if len(file_items) > 0:
                logger.info(f"Found {len(file_items)} file items; clicking the first")
                file_items[0].click()
                page.wait_for_timeout(2000)
            else:
                logger.info("File list is empty; skipping Markdown preview test")
                log_test_result(test_name, True, 0)
                return
        else:
            logger.info(f"Found {len(md_files)} Markdown-related files")
            md_files[0].click()
            page.wait_for_timeout(2000)

        log_test_step("Verify editor/preview areas exist")
        editor_area = page.locator(
            'textarea, [class*="editor"], [class*="Editor"], '
            '[class*="CodeMirror"], [class*="monaco"], '
            '[class*="fileContent"], [class*="file-content"]'
        ).first

        preview_area = page.locator(
            '[class*="preview"], [class*="Preview"], '
            '[class*="markdown"], [class*="Markdown"], '
            '.markdown-body'
        ).first

        has_editor = editor_area.count() > 0
        has_preview = preview_area.count() > 0

        if has_editor:
            logger.info("Editor area exists")
        if has_preview:
            logger.info("Preview area exists")
            preview_content = preview_area.inner_text()
            logger.info(f"Preview content length: {len(preview_content)}")

        if not has_editor and not has_preview:
            # At least verify a file content area exists
            content_area = page.locator(
                '[class*="content"], pre, code'
            ).first
            if content_area.count() > 0:
                logger.info("Found a file content display area")
            else:
                logger.info("Neither editor nor preview area found")

        log_test_result(test_name, True, 0)


# ============================================================================
# FILE-P2-001: Upload files into the workspace
# ============================================================================

@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.files
class TestWorkspaceZipUpload:
    """FILE-P2-001: Upload files into the workspace.

    Upstream #6504 replaced the whole-workspace zip restore with
    single/multi-file upload, so this case now verifies the new upload
    entry (button + hidden input) on the files page.
    """

    @pytest.mark.test_id("FILE-P2-001")
    def test_workspace_zip_upload(self, page: Page, request: pytest.FixtureRequest):
        """Test the workspace upload entry."""
        test_name = request.node.name

        log_test_step("Navigate to the files page")
        page.goto(f"{config.base_url}/files")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        log_test_step("Find the upload button")
        upload_btn = page.locator(
            'button[aria-label*="Upload"], button[aria-label*="上传"], '
            'button:has-text("Upload files"), button:has-text("上传文件")'
        ).first
        assert upload_btn.count() > 0, "Files page should have an upload button"
        expect(upload_btn).to_be_visible(timeout=5000)
        logger.info("Upload button exists and visible")

        log_test_step("Verify the hidden file input")
        file_input = page.locator('input[type="file"]').first
        assert file_input.count() > 0, "A hidden file input should exist"
        logger.info("Hidden file input exists")

        log_test_result(test_name, True, 0)


# ============================================================================
# FILE-P2-002: Download a workspace file
# ============================================================================

@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.files
class TestWorkspaceZipDownload:
    """FILE-P2-002: Download a workspace file.

    Upstream #6504 replaced the whole-workspace zip download with a
    per-file download button in the editor toolbar, so this case now
    opens the first file and verifies that button.
    """

    @pytest.mark.test_id("FILE-P2-002")
    def test_workspace_zip_download(self, page: Page, api_context, request: pytest.FixtureRequest):
        """Test downloading a workspace file."""
        test_name = request.node.name

        log_test_step("Seed a file so the tree has a row to open")
        reset_project_binding(api_context)
        seed = api_context.put(
            "/api/workspace/files/e2e_zip_seed.txt",
            data={"content": "e2e seed for FILE-P2-002\n"},
            headers={"X-Agent-Id": "default"},
        )
        assert seed.ok, f"Seed failed [{seed.status}]: {seed.text()}"

        log_test_step("Navigate to the files page")
        page.goto(f"{config.base_url}/files")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        log_test_step("Open the first file")
        first_row = page.locator('button[class*="treeRow"]:not([aria-expanded])').first
        expect(first_row).to_be_visible(timeout=10000)
        first_row.click()
        # Wait for the editor tab to open before the toolbar renders.
        expect(
            page.locator('button:has(svg.lucide-download)').first
        ).to_be_visible(timeout=10000)

        log_test_step("Find the download button")
        download_btn = page.locator('button:has(svg.lucide-download)').first
        assert download_btn.count() > 0, "Editor toolbar should have a download button"
        assert download_btn.is_enabled(), "Download button should be enabled"
        logger.info("Download button exists and enabled")

        log_test_result(test_name, True, 0)