# -*- coding: utf-8 -*-
"""
Skill-system coverage boost — second wave (batch 2).

Targets the page-reachable, no-external-network uncovered paths that the
first wave (test_cov_skills_deep.py) did not exercise:

- PUT /pool/{name}/automation  -> set_skill_automation + _configure_skill_automation
- PUT /pool/{name}/tags        -> set_pool_skill_tags
- POST /pool/upload-zip        -> SkillPoolService.import_from_zip
- POST /pool/create (with references/scripts/config) -> create_skill full path
- DELETE /pool/{name}          -> delete_skill

All cases seed their own pool skills via API, drive the real UI drawer where
possible, and clean up after themselves.

Run: pytest tests/test_cov_skills_deep2.py -v
"""
from __future__ import annotations

import io
import json
import logging
import os
import tempfile
import time
import zipfile

import pytest

from pages.skill_pool_page import SkillPoolPage
from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


def _seed_skill(api_context, name: str, content: str = "") -> bool:
    """Seed a pool skill via POST /api/skills/pool/create (soft success on conflict)."""
    body = content or (
        f"---\nname: {name}\n"
        f"description: e2e coverage probe for {name}\n---\n"
        f"# {name}\n\nSeeded by e2e batch-2.\n"
    )
    resp = api_context.post(
        "/api/skills/pool/create",
        data={"name": name, "content": body, "enable": True},
    )
    ok = resp.ok or resp.status in (400, 409)
    logger.info("_seed_skill(%s) -> HTTP %s", name, resp.status)
    return ok


def _cleanup_skill(api_context, name: str) -> None:
    """Best-effort delete of a seeded pool skill."""
    try:
        api_context.delete(f"/api/skills/pool/{name}")
    except Exception:
        pass


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestSkillAutomationAndTags:
    """
    COV-SK-002: Drawer automation toggles + tag management, driven through the
    real pool drawer UI, hitting PUT /automation and PUT /tags endpoints.
    """

    SKILL_NAME = "e2e_cov2_automation"

    @pytest.mark.test_id("COV-SK-002")
    def test_skill_automation_and_tags(
        self,
        skill_pool_page: SkillPoolPage,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Seed a pool skill")
        assert _seed_skill(api_context, self.SKILL_NAME), "Failed to seed pool skill"

        try:
            log_test_step("2. Open the pool drawer for the seeded skill")
            skill_pool_page.open()
            skill_pool_page.page.wait_for_timeout(1500)
            card = skill_pool_page.find_card_by_name(self.SKILL_NAME)
            assert card is not None, "Seeded skill card not visible in pool"
            card.scroll_into_view_if_needed(timeout=5000)
            card.click()
            skill_pool_page.page.wait_for_timeout(1200)

            log_test_step("3. Toggle automation switches in the drawer")
            drawer = skill_pool_page.page.locator(
                ".qwenpaw-drawer-body, .ant-drawer-body"
            ).first
            assert drawer.count() > 0, "Drawer did not open"
            switches = drawer.locator(".qwenpaw-switch")
            n_switch = switches.count()
            logger.info("Drawer switch count: %d", n_switch)
            assert n_switch >= 1, "No automation switch found in drawer"
            for i in range(n_switch):
                try:
                    drawer.locator(".qwenpaw-switch").nth(i).click()
                    skill_pool_page.page.wait_for_timeout(300)
                except Exception as exc:
                    logger.warning("switch %d not clickable: %s", i, exc)

            log_test_step("4. Save drawer -> PUT /automation")
            save_btn = skill_pool_page.page.locator(
                ".qwenpaw-drawer button:has-text('Save')"
            ).first
            assert save_btn.count() > 0, "Save button missing"
            save_btn.click()
            skill_pool_page.page.wait_for_timeout(1500)

            log_test_step("5. Set tags via API (page-reachable endpoint)")
            resp = api_context.put(
                f"/api/skills/pool/{self.SKILL_NAME}/tags",
                data=["e2e", "cov2"],
            )
            assert resp.ok, f"PUT tags failed: {resp.status}"
            tags_body = resp.json()
            assert tags_body.get("updated") is True, "tags not updated"
            assert set(tags_body.get("tags", [])) == {"e2e", "cov2"}

            log_test_result(test_name, True, 0)
        finally:
            _cleanup_skill(api_context, self.SKILL_NAME)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestSkillPoolZipImport:
    """
    COV-SK-003: Pool zip import via POST /pool/upload-zip, exercising
    SkillPoolService.import_from_zip (44 uncovered lines).
    """

    SKILL_NAME = "e2e_cov2_zipskill"

    @staticmethod
    def _build_zip(skill_name: str) -> bytes:
        """Build an in-memory zip containing a single SKILL.md skill."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(
                f"{skill_name}/SKILL.md",
                f"---\nname: {skill_name}\n"
                f"description: e2e zip-imported skill\n---\n"
                f"# {skill_name}\n\nImported via zip.\n",
            )
        return buf.getvalue()

    @pytest.mark.test_id("COV-SK-003")
    def test_pool_zip_import(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Build a zip containing one skill")
        zip_bytes = self._build_zip(self.SKILL_NAME)
        assert len(zip_bytes) > 0, "zip build failed"

        log_test_step("2. Upload via POST /api/skills/pool/upload-zip")
        # Playwright's APIRequestContext multipart does not produce a part
        # FastAPI accepts as UploadFile; use requests for the file field.
        import requests
        from config.settings import config as cfg

        base = cfg.base_url
        tmp_zip = tempfile.NamedTemporaryFile(
            suffix=".zip", delete=False, prefix="e2e_cov2_"
        )
        tmp_zip.write(zip_bytes)
        tmp_zip.close()
        try:
            with open(tmp_zip.name, "rb") as fh:
                http_resp = requests.post(
                    f"{base}/api/skills/pool/upload-zip",
                    files={"file": ("skill.zip", fh, "application/zip")},
                    timeout=60,
                )
        finally:
            os.unlink(tmp_zip.name)

        class _Resp:
            ok = 200 <= http_resp.status_code < 300
            status = http_resp.status_code

            @staticmethod
            def json():
                return http_resp.json()

            @staticmethod
            def text():
                return http_resp.text

        resp = _Resp()
        # 409 = conflict from a previous run; treat as soft success
        assert resp.ok or resp.status == 409, f"zip upload failed: {resp.status} {resp.text()[:200]}"
        if resp.ok:
            body = resp.json()
            logger.info("zip import result: %s", json.dumps(body)[:200])

        log_test_step("3. Verify the skill appears in the pool")
        list_resp = api_context.get("/api/skills/pool")
        assert list_resp.ok, "pool list failed"
        names = [s.get("name") for s in list_resp.json()]
        assert self.SKILL_NAME in names, f"{self.SKILL_NAME} not in pool after import"

        log_test_result(test_name, True, 0)
        _cleanup_skill(api_context, self.SKILL_NAME)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestSkillCreateWithAttachments:
    """
    COV-SK-004: Create a pool skill with references + scripts + config via
    POST /pool/create, exercising the full create_skill path (24 uncovered
    lines), then delete it (delete_skill, 15 uncovered lines).
    """

    SKILL_NAME = "e2e_cov2_fullskill"

    @pytest.mark.test_id("COV-SK-004")
    def test_create_skill_full_path(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Create a pool skill with references, scripts, and config")
        resp = api_context.post(
            "/api/skills/pool/create",
            data={
                "name": self.SKILL_NAME,
                "content": (
                    f"---\nname: {self.SKILL_NAME}\n"
                    f"description: full-coverage create probe\n---\n"
                    f"# {self.SKILL_NAME}\n\nFull create path.\n"
                ),
                "references": {"notes/README.md": "# ref\n"},
                "scripts": {"run.sh": "#!/bin/sh\necho ok\n"},
                "config": {"timeout": 30},
                "enable": True,
            },
        )
        assert resp.ok, f"create with attachments failed: {resp.status} {resp.text()[:200]}"
        body = resp.json()
        assert body.get("created") is True, "created flag missing"

        log_test_step("2. Verify the skill detail round-trips")
        detail_resp = api_context.get(f"/api/skills/pool/{self.SKILL_NAME}")
        assert detail_resp.ok, f"pool detail failed: {detail_resp.status}"

        log_test_step("3. Delete the skill (delete_skill path)")
        del_resp = api_context.delete(f"/api/skills/pool/{self.SKILL_NAME}")
        assert del_resp.ok or del_resp.status == 404, f"delete failed: {del_resp.status}"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestSkillPoolDownloadAndRename:
    """
    COV-SK-005: Download a pool skill into the default workspace
    (POST /pool/download -> _download_one_or_raise + rollback wiring),
    then rename it via PUT /pool/save (save_pool_skill rename path).
    """

    SKILL_NAME = "e2e_cov2_dlskill"
    RENAMED = "e2e_cov2_dlskill_renamed"

    @pytest.mark.test_id("COV-SK-005")
    def test_pool_download_and_rename(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Seed a pool skill")
        assert _seed_skill(api_context, self.SKILL_NAME), "seed failed"

        try:
            log_test_step("2. Download it into the default workspace")
            resp = api_context.post(
                "/api/skills/pool/download",
                data={
                    "skill_name": self.SKILL_NAME,
                    "targets": [{"workspace_id": "default"}],
                    "overwrite": True,
                },
            )
            assert resp.ok, f"pool download failed: {resp.status} {resp.text()[:200]}"
            body = resp.json()
            downloaded = body.get("downloaded", [])
            assert len(downloaded) == 1, f"expected 1 download, got {downloaded}"

            log_test_step("3. Rename via PUT /pool/save")
            content = (
                f"---\nname: {self.RENAMED}\n"
                f"description: renamed pool skill\n---\n"
                f"# {self.RENAMED}\n\nRenamed by e2e.\n"
            )
            resp = api_context.put(
                "/api/skills/pool/save",
                data={
                    "source_name": self.SKILL_NAME,
                    "name": self.RENAMED,
                    "content": content,
                    "overwrite": False,
                },
            )
            assert resp.ok, f"pool save rename failed: {resp.status} {resp.text()[:200]}"

            log_test_step("4. Verify the renamed skill exists in the pool")
            list_resp = api_context.get("/api/skills/pool")
            names = [s.get("name") for s in list_resp.json()]
            assert self.RENAMED in names, f"{self.RENAMED} not in pool after rename"

            log_test_result(test_name, True, 0)
        finally:
            _cleanup_skill(api_context, self.SKILL_NAME)
            _cleanup_skill(api_context, self.RENAMED)
            # best-effort workspace cleanup of the downloaded skill
            try:
                api_context.delete(f"/api/skills/{self.SKILL_NAME}")
                api_context.delete(f"/api/skills/{self.RENAMED}")
            except Exception:
                pass


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skills
class TestSkillPoolConfigRoundTrip:
    """
    COV-SK-006: Pool skill config get/put/delete round trip (drawer Config
    section) — GET/PUT/DELETE /pool/{name}/config endpoints.
    """

    SKILL_NAME = "e2e_cov2_cfgskill"

    @pytest.mark.test_id("COV-SK-006")
    def test_config_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Seed a pool skill")
        assert _seed_skill(api_context, self.SKILL_NAME), "seed failed"

        try:
            log_test_step("2. Read config (initially empty)")
            resp = api_context.get(f"/api/skills/pool/{self.SKILL_NAME}/config")
            assert resp.ok, f"GET config failed: {resp.status}"
            assert resp.json().get("config") == {}, "expected empty initial config"

            log_test_step("3. Write config")
            new_cfg = {"temperature": 0.5, "max_turns": 3}
            resp = api_context.put(
                f"/api/skills/pool/{self.SKILL_NAME}/config",
                data={"config": new_cfg},
            )
            assert resp.ok, f"PUT config failed: {resp.status}"

            log_test_step("4. Read config back")
            resp = api_context.get(f"/api/skills/pool/{self.SKILL_NAME}/config")
            assert resp.json().get("config") == new_cfg, "config round-trip mismatch"

            log_test_step("5. Delete config")
            resp = api_context.delete(f"/api/skills/pool/{self.SKILL_NAME}/config")
            assert resp.ok, f"DELETE config failed: {resp.status}"
            assert resp.json().get("cleared") is True

            log_test_result(test_name, True, 0)
        finally:
            _cleanup_skill(api_context, self.SKILL_NAME)
