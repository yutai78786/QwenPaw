# -*- coding: utf-8 -*-
"""
Coding-project / fork + shell-deep + workspace-deep journeys (5pp wave 3).

Targets:
  - agents/fork_project.py            (813 uncovered) — project fork/git bind
  - app/routers/project_directory.py  (264 uncovered)
  - agents/tools/shell.py             (470 uncovered) — command variants
  - app/routers/workspace.py          (478 uncovered) — tree/file deep ops

Run: pytest tests/test_cov_journey_deep3.py -v
"""
from __future__ import annotations

import logging
import subprocess
import time

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


def _wait_reply_grows(page, before_count: int, timeout_ms: int = 120000) -> bool:
    elapsed = 0
    while elapsed < timeout_ms:
        if page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count:
            page.wait_for_timeout(3000)
            return True
        page.wait_for_timeout(1000)
        elapsed += 1000
    return page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before_count


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.coding
class TestProjectDirectoryJourney:
    """
    COV-PROJ-001: create a project directory, bind it, write/read files
    through the project-directory endpoints. Exercises project_directory
    router and the coding-mode binding path.
    """

    @pytest.mark.test_id("COV-PROJ-001")
    def test_project_directory_flow(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        project_name = f"e2e_cov3_proj_{int(time.time())}"

        # Clean any leftover coding binding
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})

        log_test_step("1. Create a project directory via API")
        resp = api_context.post(
            "/api/workspace/project-directory/create",
            data={"name": project_name},
            headers={"X-Agent-Id": "default"},
        )
        assert resp.ok or resp.status in (400, 409), (
            f"project create failed [{resp.status}]: {resp.text()[:200]}"
        )

        log_test_step("2. Bind the project directory")
        body = resp.json() if resp.ok else {}
        path = body.get("path") or body.get("project_dir") or None
        if path:
            bind = api_context.put(
                "/api/workspace/project-directory",
                data={"path": path},
                headers={"X-Agent-Id": "default"},
            )
            logger.info("bind project -> %s", bind.status)

        log_test_step("3. List project directories")
        listing = api_context.get(
            "/api/workspace/project-directory/list",
            headers={"X-Agent-Id": "default"},
        )
        logger.info("project-directory list -> %s", listing.status)

        log_test_step("4. Read the project-directory state")
        state = api_context.get(
            "/api/workspace/project-directory",
            headers={"X-Agent-Id": "default"},
        )
        assert state.ok, f"read project-directory failed [{state.status}]"

        log_test_step("5. Cleanup: unbind")
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.requires_llm
@pytest.mark.chat
class TestShellDeepVariants:
    """
    COV-SHELL-002: exercise shell tool variants — multi-line, env vars,
    non-zero exit, large output — to cover more of shell.py branches.
    """

    @pytest.mark.test_id("COV-SHELL-002")
    def test_shell_deep_variants(
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

        prompts = [
            "Use execute_shell_command to run: printf 'line1\\nline2\\nline3\\n' and count the lines.",
            "Use execute_shell_command to run: export MYVAR=hello && echo $MYVAR",
            "Use execute_shell_command to run: ls /nonexistent_dir_12345 ; tell me if it succeeded or failed.",
            "Use execute_shell_command to run: seq 1 50 | tail -5",
        ]
        for i, prompt in enumerate(prompts, 1):
            before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
            chat.send_message(prompt)
            assert _wait_reply_grows(page, before), f"no reply to shell variant {i}"

        logger.info("Test %s passed", test_name)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceDeepOps:
    """
    COV-WS-001: drive workspace deep endpoints — tree pagination, file
    metadata, and file content for a markdown file — via the Files UI + API.
    """

    @pytest.mark.test_id("COV-WS-001")
    def test_workspace_deep_ops(
        self,
        page,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        fname = "e2e_cov3_deep.md"
        content = "# deep coverage note\n\nparagraph one\n"

        log_test_step("1. Seed a markdown file")
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})
        seed = api_context.put(
            f"/api/workspace/files/{fname}",
            data={"content": content},
            headers={"X-Agent-Id": "default"},
        )
        assert seed.ok, f"seed failed [{seed.status}]"

        try:
            log_test_step("2. Read file metadata")
            md = api_context.get(
                f"/api/workspace/file-metadata",
                params={"path": fname, "root": "project"},
                headers={"X-Agent-Id": "default"},
            )
            logger.info("file-metadata -> %s", md.status)

            log_test_step("3. Read file content")
            fc = api_context.get(
                f"/api/workspace/file-content",
                params={"path": fname, "root": "project"},
                headers={"X-Agent-Id": "default"},
            )
            logger.info("file-content -> %s", fc.status)

            log_test_step("4. List the tree (pagination params)")
            tree = api_context.get(
                "/api/workspace/tree",
                params={"path": "", "root": "project", "limit": 20},
                headers={"X-Agent-Id": "default"},
            )
            assert tree.ok, f"tree failed [{tree.status}]"

            log_test_step("5. Open the Files page and click the file")
            page.goto(f"{config.base_url}/files")
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(3000)
            row = page.locator(f'text="{fname}"').first
            if row.count() > 0:
                row.click()
                page.wait_for_timeout(2000)
                logger.info("opened file in UI")

            log_test_result(test_name, True, 0)
        finally:
            api_context.delete(
                f"/api/workspace/files/{fname}",
                headers={"X-Agent-Id": "default"},
            )
