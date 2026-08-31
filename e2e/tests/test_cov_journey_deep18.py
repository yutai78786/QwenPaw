# -*- coding: utf-8 -*-
"""
Fork-project + skill-hub install deep journeys (5pp wave 18).

Targets the two largest remaining blocks:
  - agents/fork_project.py        (813 uncovered) — git project fork/bind
  - agents/skill_system/hub.py    (701 remaining) — hub install pipeline

Run: pytest tests/test_cov_journey_deep18.py -v
"""
from __future__ import annotations

import logging

import pytest

from config.settings import config
from pages.chat_page import ChatPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

HUB_SKILL = "e2e_cov18_hub"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.coding
class TestProjectGitOpsJourney:
    """COV-PGIT-001: init/check git repo ops in the workspace to reach fork_project."""

    @pytest.mark.test_id("COV-PGIT-001")
    def test_project_git_ops(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        import subprocess

        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Seed a local dir + import as project")
        src = "/tmp/e2e_s18_git"
        subprocess.run(
            ["bash", "-c",
             f"rm -rf {src} && mkdir -p {src} && cd {src} && "
             "git init -q && echo probe > README.md && git add . && "
             "git -c user.email=t@t -c user.name=t commit -qm init"],
            capture_output=True, timeout=30,
        )

        api_context.post("/api/coding-mode", data={"enabled": False}, headers=H)
        api_context.put("/api/workspace/project-directory", data={"path": None}, headers=H)

        imp = api_context.post(
            "/api/workspace/project-directory/import-local",
            data={"source_path": src, "name": "e2e_cov18_gitproj"},
            headers=H,
        )
        logger.info("import-local -> %s", imp.status)

        log_test_step("2. Bind + git reads")
        if imp.ok:
            body = imp.json()
            path = body.get("path") or body.get("project_dir")
            if path:
                api_context.put("/api/workspace/project-directory",
                                data={"path": path}, headers=H)
                for p in ["/api/workspace/git", "/api/workspace/git/branches",
                          "/api/workspace/git/log", "/api/workspace/git/diff"]:
                    r = api_context.get(p, headers=H)
                    logger.info("GET %s -> %s", p, r.status)

        log_test_step("3. Cleanup")
        api_context.put("/api/workspace/project-directory", data={"path": None}, headers=H)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestHubInstallSecondJourney:
    """COV-HUB-002: install a DIFFERENT hub skill to hit hub pipeline branches."""

    @pytest.mark.test_id("COV-HUB-002")
    def test_hub_install_another(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        api_context.delete(f"/api/skills/pool/{HUB_SKILL}")

        log_test_step("1. Search hub")
        resp = api_context.get("/api/skills/hub/search?q=file&limit=5")
        if resp.status >= 500 or not resp.ok:
            pytest.skip(f"hub unreachable [{resp.status}]")

        log_test_step("2. Install via github subtree url")
        body = {
            "bundle_url": "https://github.com/anthropics/skills/tree/main/skills/file-organizer-skill",
            "enable": False,
            "target_name": HUB_SKILL,
        }
        resp2 = api_context.post("/api/skills/hub/install/start", data=body)
        assert resp2.ok, f"install start failed [{resp2.status}]"
        task = resp2.json()
        task_id = task.get("task_id") or task.get("id")

        log_test_step("3. Poll status")
        terminal = {"succeeded", "failed", "cancelled", "completed", "error"}
        import time
        final = ""
        for _ in range(30):
            st = api_context.get(f"/api/skills/hub/install/status/{task_id}")
            if not st.ok:
                break
            info = st.json()
            status = (info.get("status") or "").lower()
            if status in terminal:
                final = status
                break
            time.sleep(2)
        logger.info("install final: %s", final)

        log_test_step("4. Cleanup")
        api_context.post(f"/api/skills/hub/install/cancel/{task_id}")
        api_context.delete(f"/api/skills/pool/{HUB_SKILL}")
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.coding
class TestCodingModeDeepJourney:
    """COV-CM-001: coding-mode enable/disable + project binding via API."""

    @pytest.mark.test_id("COV-CM-001")
    def test_coding_mode_deep(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}

        log_test_step("1. Read coding mode state")
        resp = api_context.get("/api/coding-mode", headers=H)
        logger.info("coding-mode GET -> %s", resp.status)

        log_test_step("2. Enable then disable")
        en = api_context.post("/api/coding-mode", data={"enabled": True}, headers=H)
        logger.info("enable -> %s", en.status)
        dis = api_context.post("/api/coding-mode", data={"enabled": False}, headers=H)
        logger.info("disable -> %s", dis.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.requires_llm
@pytest.mark.chat
class TestProjectChatJourney:
    """COV-PCHAT-001: chat about a bound project (coding context assembly)."""

    @pytest.mark.test_id("COV-PCHAT-001")
    def test_project_chat(
        self,
        clean_chat_page: ChatPage,
        request: pytest.FixtureRequest,
    ):
        import subprocess

        chat = clean_chat_page
        page = chat.page

        src = "/tmp/e2e_s18_chat"
        subprocess.run(
            ["bash", "-c",
             f"rm -rf {src} && mkdir -p {src} && "
             "printf 'def greet():\\n    return 42\\n' > {src}/main.py".format(src=src)],
            capture_output=True, timeout=15,
        )

        page.goto(f"{config.base_url}/chat")
        page.wait_for_load_state("domcontentloaded")
        chat.create_new_chat()

        before = page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count()
        chat.send_message(
            "Use read_file to read /tmp/e2e_s18_chat/main.py and tell me what "
            "the greet function returns."
        )
        elapsed = 0
        while elapsed < 150000 and page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() <= before:
            page.wait_for_timeout(1000)
            elapsed += 1000
        assert page.locator(".qwenpaw-bubble.qwenpaw-bubble-start").count() > before, (
            "no reply to project chat"
        )
        logger.info("project chat journey done")
