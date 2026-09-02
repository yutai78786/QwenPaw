# -*- coding: utf-8 -*-
"""
Plugin install/uninstall + remaining router tails (5pp wave 27).

Deterministic coverage of the big remaining targets:
- /plugins/install from local path (minimal real plugin) -> loader,
  validation, registry, hot reload (~600 lines across plugins/)
- /plugins/{id} status/files/uninstall
- /coding-mode get/toggle round trip
- /pawapps list + unknown app surfaces
- /skills/pool/import-builtin + update-builtin + /pool/upload preview
- /agents/{id}/memory/reindex

All calls are pure API round trips (no LLM), deterministic by design.

Run: pytest tests/test_cov_journey_deep27.py -v
"""
from __future__ import annotations

import io
import json
import logging
import os
import zipfile

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PLUGIN_ID = "e2e_cov27_probe_plugin"

# Minimal but valid plugin package: manifest + empty backend module.
PLUGIN_JSON = json.dumps({
    "id": PLUGIN_ID,
    "version": "0.0.1",
    "name": "E2E Cov27 Probe Plugin",
    "description": "coverage probe, safe to delete",
    "author": "qpqat-e2e",
    "type": "general",
    "entry": {"backend": "probe_backend.py"},
    "dependencies": [],
})
PROBE_BACKEND = (
    "class _ProbePlugin:\n"
    "    def register(self, api):\n"
    "        return None\n"
    "\n"
    "plugin = _ProbePlugin()\n"
)


def _plain_http():
    import requests as http_requests
    from config.settings import config
    return http_requests, config.server.base_url


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.plugins
class TestPluginInstallLifecycleRest:
    """COV-PLG-002: local-path install -> status -> files -> uninstall."""

    @pytest.mark.test_id("COV-PLG-002")
    def test_plugin_install_lifecycle(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        import tempfile, shutil

        log_test_step("1. Uninstall any leftover probe plugin")
        api_context.delete(f"/api/plugins/{PLUGIN_ID}")

        log_test_step("2. Build a minimal plugin dir and install by path")
        src = tempfile.mkdtemp(prefix="e2e_cov27_plugin_")
        try:
            with open(os.path.join(src, "plugin.json"), "w") as fh:
                fh.write(PLUGIN_JSON)
            with open(os.path.join(src, "probe_backend.py"), "w") as fh:
                fh.write(PROBE_BACKEND)
            ins = api_context.post(
                "/api/plugins/install",
                data=json.dumps({"source": src, "force": True}),
            )
            logger.info("plugin install -> %s %s", ins.status, ins.text()[:150])
            assert ins.status in (200, 201), (
                f"plugin install failed [{ins.status}]: {ins.text()[:200]}"
            )

            log_test_step("3. Status + file listing surfaces")
            st = api_context.get(f"/api/plugins/{PLUGIN_ID}/status")
            logger.info("plugin status -> %s", st.status)
            ff = api_context.get(
                f"/api/plugins/{PLUGIN_ID}/files/plugin.json")
            logger.info("plugin file read -> %s", ff.status)
        finally:
            shutil.rmtree(src, ignore_errors=True)

        log_test_step("4. Install from missing path -> 400 branch")
        bad = api_context.post(
            "/api/plugins/install",
            data=json.dumps({"source": "/tmp/e2e_cov27_no_such_dir"}),
        )
        assert bad.status == 400, f"missing path expected 400 [{bad.status}]"

        log_test_step("5. Upload a zip plugin then uninstall both")
        http, base = _plain_http()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("plugin.json", PLUGIN_JSON)
            zf.writestr("probe_backend.py", PROBE_BACKEND)
        up = http.post(
            f"{base}/api/plugins/upload?force=true",
            files={"file": ("probe.zip", io.BytesIO(buf.getvalue()), "application/zip")},
            headers={"X-Agent-Id": "default"},
            timeout=120,
        )
        logger.info("plugin upload -> %s", up.status_code)
        assert up.status_code in (200, 201, 409), (
            f"plugin upload [{up.status_code}]: {up.text[:200]}"
        )

        log_test_step("6. Uninstall probe plugin + unknown-id 404 branch")
        dele = api_context.delete(f"/api/plugins/{PLUGIN_ID}")
        logger.info("plugin uninstall -> %s", dele.status)
        assert dele.status in (200, 204), f"uninstall [{dele.status}]"
        unknown = api_context.delete("/api/plugins/e2e_cov27_none")
        assert unknown.status in (400, 404, 500), (
            f"unknown uninstall [{unknown.status}]"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.coding
class TestCodingModeToggle:
    """COV-CM-001: coding-mode get -> toggle -> restore."""

    @pytest.mark.test_id("COV-CM-001")
    def test_coding_mode_toggle(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Get current state")
        st0 = api_context.get("/api/coding-mode")
        assert st0.ok, f"coding-mode get [{st0.status}]"
        orig = bool(st0.json().get("enabled"))

        log_test_step("2. Toggle -> verify -> restore")
        on = api_context.post(
            "/api/coding-mode", data=json.dumps({"enabled": True}))
        assert on.ok, f"coding-mode on [{on.status}]"
        off = api_context.post(
            "/api/coding-mode", data=json.dumps({"enabled": orig}))
        assert off.ok, f"coding-mode restore [{off.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.debug
class TestPawappsSurfaces:
    """COV-PA-001: pawapps list + unknown app detail/settings/static."""

    @pytest.mark.test_id("COV-PA-001")
    def test_pawapps_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List pawapps")
        ls = api_context.get("/api/pawapps")
        assert ls.ok, f"pawapps list [{ls.status}]"
        payload = ls.json()
        app_ids = list(payload.keys())[:3] if isinstance(payload, dict) else []

        log_test_step("2. Known app detail/settings; unknown app branches")
        for app_id in app_ids:
            d = api_context.get(f"/api/pawapps/{app_id}")
            s = api_context.get(f"/api/pawapps/{app_id}/settings")
            logger.info("pawapp %s detail=%s settings=%s", app_id, d.status, s.status)
        unk = api_context.get("/api/pawapps/e2e_cov27_none")
        assert unk.status in (400, 404), f"unknown pawapp [{unk.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.skill_pool
class TestSkillPoolBuiltinSurfaces:
    """COV-SPB-001: pool import-builtin + update-builtin + upload preview."""

    @pytest.mark.test_id("COV-SPB-001")
    def test_skill_pool_builtin_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Builtin sources list")
        src = api_context.get("/api/skills/pool/builtin-sources")
        assert src.ok, f"builtin-sources [{src.status}]"
        names = []
        payload = src.json()
        if isinstance(payload, list):
            names = [
                (it.get("skill_name") or it.get("name") or "")
                for it in payload[:3]
            ]
        elif isinstance(payload, dict):
            items = payload.get("skills") or payload.get("sources") or []
            names = [
                (it.get("skill_name") or it.get("name") or "")
                for it in items[:3]
            ]
        names = [n for n in names if n]
        logger.info("builtin candidates: %s", names)

        log_test_step("2. Import builtins (no-overwrite) if candidates exist")
        if names:
            imp = api_context.post(
                "/api/skills/pool/import-builtin",
                data=json.dumps({
                    "imports": [{"skill_name": names[0]}],
                    "overwrite_conflicts": False,
                }),
            )
            logger.info("import-builtin -> %s", imp.status)
            upd = api_context.post(
                f"/api/skills/pool/{names[0]}/update-builtin",
                data=json.dumps({"language": ""}),
            )
            logger.info("update-builtin -> %s", upd.status)

        log_test_step("3. Bad language -> 400 branch")
        if names:
            bad = api_context.post(
                f"/api/skills/pool/{names[0]}/update-builtin",
                data=json.dumps({"language": "xx-XX"}),
            )
            assert bad.status == 400, f"bad language [{bad.status}]"

        log_test_step("4. Upload-from-workspace preview branch (missing skill)")
        up = api_context.post(
            "/api/skills/pool/upload",
            data=json.dumps({
                "workspace_id": "default",
                "skill_name": "e2e_cov27_no_such_skill",
                "preview_only": True,
            }),
        )
        assert up.status in (400, 404), f"upload preview [{up.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.memory
class TestMemoryReindexEndpoint:
    """COV-MRI-001: POST /agents/{id}/memory/reindex surface."""

    @pytest.mark.test_id("COV-MRI-001")
    def test_memory_reindex_surface(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Trigger reindex for default agent")
        r = api_context.post("/api/agents/default/memory/reindex")
        logger.info("reindex -> %s", r.status)
        assert r.status in (200, 202, 400, 409), f"reindex [{r.status}]"

        log_test_result(test_name, True, 0)
