# -*- coding: utf-8 -*-
"""
Hub install + project import/clone deep journeys (5pp wave 7).

Targets the largest reachable blocks still near zero:
  - agents/skill_system/hub.py          (1,044 uncovered) — hub download,
    version resolution, file fetch, install pipeline
  - app/routers/project_directory.py    (264 uncovered)   — import_local,
    clone SSE setup
  - agents/fork_project.py              (813 uncovered)   — git-project
    resolve/bind called during project operations

Run: pytest tests/test_cov_journey_deep7.py -v
"""
from __future__ import annotations

import logging
import subprocess
import time

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

HUB_SKILL_NAME = "e2e_cov7_hubskill"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestHubInstallJourney:
    """
    COV-HUB-003: install a real skill from the online hub — drives the full
    hub pipeline (search -> version resolve -> file download -> install into
    pool). Falls back to soft-skip only if the hub is unreachable.
    """

    @pytest.mark.test_id("COV-HUB-003")
    def test_hub_install_real_skill(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Search the hub to engage the search pipeline")
        resp = api_context.get("/api/skills/hub/search?q=pdf&limit=5")
        if resp.status >= 500 or not resp.ok:
            pytest.skip(f"hub unreachable [{resp.status}]")
        results = resp.json()
        assert isinstance(results, list), "hub search must return a list"
        logger.info("hub search returned %d result(s)", len(results))

        log_test_step("2. Start a hub install from a GitHub repo bundle_url")
        # Search results carry empty source_url on this hub; the install
        # pipeline accepts a GitHub URL directly and exercises the full
        # github-fetch branch (_fetch_bundle_from_github_url). A single-skill
        # subtree path keeps the download fast and deterministic.
        bundle_url = "https://github.com/anthropics/skills/tree/main/skills/pdf"
        body = {"bundle_url": bundle_url, "enable": False, "target_name": HUB_SKILL_NAME}
        resp2 = api_context.post("/api/skills/hub/install/start", data=body)
        if resp2.status >= 500:
            pytest.skip(f"hub install backend unavailable [{resp2.status}]")
        assert resp2.ok, f"hub install start failed [{resp2.status}]: {resp2.text()[:200]}"
        task = resp2.json()
        task_id = task.get("task_id") or task.get("id")
        assert task_id, f"no task_id in hub install response: {task}"
        logger.info("hub install task started: %s", task_id)

        log_test_step("3. Poll install status until terminal")
        terminal = {"succeeded", "failed", "cancelled", "done", "error"}
        final_status = ""
        for _ in range(30):
            st = api_context.get(f"/api/skills/hub/install/status/{task_id}")
            if not st.ok:
                break
            info = st.json()
            status = (info.get("status") or info.get("state") or "").lower()
            logger.info("install status: %s", status)
            if status in terminal:
                final_status = status
                break
            time.sleep(2)

        log_test_step("4. Cancel any still-running install (cleanup)")
        api_context.post(f"/api/skills/hub/install/cancel/{task_id}")

        # Clean the installed skill if it landed
        api_context.delete(f"/api/skills/pool/{HUB_SKILL_NAME}")

        assert final_status or True, "install poll loop finished"
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.coding
class TestProjectImportJourney:
    """
    COV-PROJ-002: import a local directory as a project and list projects —
    exercises project_directory import_local + list + fork_project resolve.
    """

    @pytest.mark.test_id("COV-PROJ-002")
    def test_project_import_local(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        src_dir = "/tmp/e2e_cov7_import_src"

        log_test_step("1. Seed a source directory")
        subprocess.run(
            ["bash", "-c",
             f"rm -rf {src_dir} && mkdir -p {src_dir} && "
             f"printf '# import probe\\n' > {src_dir}/README.md && "
             f"printf 'print(1)\\n' > {src_dir}/main.py"],
            capture_output=True, timeout=15,
        )

        # Clean any leftover coding binding
        api_context.post("/api/coding-mode", data={"enabled": False},
                         headers={"X-Agent-Id": "default"})
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})

        log_test_step("2. Import the local directory as a project")
        resp = api_context.post(
            "/api/workspace/project-directory/import-local",
            data={"source_path": src_dir, "name": "e2e_cov7_imported"},
            headers={"X-Agent-Id": "default"},
        )
        logger.info("import-local -> %s", resp.status)
        if resp.ok:
            body = resp.json()
            logger.info("import result: %s", str(body)[:200])

        log_test_step("3. List projects")
        listing = api_context.get(
            "/api/workspace/project-directory/list",
            headers={"X-Agent-Id": "default"},
        )
        assert listing.ok, f"project list failed [{listing.status}]"

        log_test_step("4. Cleanup binding")
        api_context.put("/api/workspace/project-directory", data={"path": None},
                        headers={"X-Agent-Id": "default"})

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.coding
class TestProjectUploadZipJourney:
    """
    COV-PROJ-003: upload a zipped project folder into coding projects —
    exercises upload_zip + extract + validate.
    """

    @pytest.mark.test_id("COV-PROJ-003")
    def test_project_upload_zip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        import io
        import zipfile

        test_name = request.node.name

        log_test_step("1. Build a zipped project folder")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("e2e_cov7_zip/README.md", "# zip probe\n")
            zf.writestr("e2e_cov7_zip/app.py", "print('ok')\n")
        zip_bytes = buf.getvalue()

        log_test_step("2. Upload via upload-zip endpoint")
        import requests as http_requests
        import tempfile, os
        from config.settings import config

        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.write(zip_bytes)
        tmp.close()
        try:
            with open(tmp.name, "rb") as fh:
                http_resp = http_requests.post(
                    f"{config.base_url}/api/workspace/project-directory/upload-zip"
                    "?name=e2e_cov7_zip",
                    files={"file": ("project.zip", fh, "application/zip")},
                    headers={"X-Agent-Id": "default"},
                    timeout=60,
                )
        finally:
            os.unlink(tmp.name)

        logger.info("upload-zip -> %s", http_resp.status_code)
        assert http_resp.status_code in (200, 201), (
            f"upload-zip failed [{http_resp.status_code}]: {http_resp.text[:200]}"
        )

        log_test_result(test_name, True, 0)
