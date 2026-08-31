# -*- coding: utf-8 -*-
"""
Plugin install/upload coverage journey (5pp wave).

Targets plugins/loader.py (434 uncovered) + plugins/api.py (398 uncovered)
+ app/routers/plugins.py (366 uncovered) by uploading and hot-loading a
minimal real plugin, then unloading it.

Run: pytest tests/test_cov_plugin_journey.py -v
"""
from __future__ import annotations

import io
import json
import logging
import zipfile

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PLUGIN_ID = "e2e_cov_plugin"

PLUGIN_JSON = json.dumps(
    {
        "id": PLUGIN_ID,
        "name": "E2E Coverage Plugin",
        "version": "0.0.1",
        "description": "Minimal plugin uploaded by the e2e coverage journey.",
        "entry": {"backend": "plugin.py"},
    }
)

PLUGIN_PY = (
    "# -*- coding: utf-8 -*-\n"
    '"""Minimal plugin used by the e2e coverage journey."""\n'
    "import logging\n"
    "\n"
    'logger = logging.getLogger("qwenpaw").getChild("plugin.e2e_cov_plugin")\n'
    "\n"
    "\n"
    "class _E2ECovPlugin:\n"
    "    def register(self, api) -> None:\n"
    '        logger.info("e2e coverage plugin registered")\n'
    "\n"
    "\n"
    "plugin = _E2ECovPlugin()\n"
)


def _build_plugin_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{PLUGIN_ID}/plugin.json", PLUGIN_JSON)
        zf.writestr(f"{PLUGIN_ID}/plugin.py", PLUGIN_PY)
    return buf.getvalue()


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.plugins
class TestPluginUploadJourney:
    """
    COV-PLUG-001: upload a plugin zip -> hot-load -> verify it appears in
    the list -> unload. Exercises loader + api + plugins router.
    """

    @pytest.mark.test_id("COV-PLUG-001")
    def test_plugin_upload_and_unload(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        import requests as http_requests
        from config.settings import config

        test_name = request.node.name

        # Defensive cleanup from a previous run (best-effort)
        api_context.delete(f"/api/plugins/{PLUGIN_ID}")

        log_test_step("1. Build a minimal plugin zip in memory")
        zip_bytes = _build_plugin_zip()
        assert len(zip_bytes) > 0, "zip build failed"

        log_test_step("2. Upload via POST /api/plugins/upload")
        import tempfile
        import os

        tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        tmp.write(zip_bytes)
        tmp.close()
        try:
            with open(tmp.name, "rb") as fh:
                http_resp = http_requests.post(
                    f"{config.base_url}/api/plugins/upload",
                    files={"file": ("plugin.zip", fh, "application/zip")},
                    timeout=60,
                )
        finally:
            os.unlink(tmp.name)

        assert http_resp.status_code in (200, 201), (
            f"plugin upload failed [{http_resp.status_code}]: "
            f"{http_resp.text[:200]}"
        )
        logger.info("plugin uploaded and hot-loaded")

        log_test_step("3. Verify the plugin appears in the list")
        listing = api_context.get("/api/plugins")
        assert listing.ok, f"plugin list failed [{listing.status}]"
        data = listing.json()
        items = data if isinstance(data, list) else data.get("plugins", [])
        ids = [p.get("id") for p in items]
        assert PLUGIN_ID in ids, f"{PLUGIN_ID} not in {ids}"

        log_test_step("4. Unload the plugin")
        resp = api_context.delete(f"/api/plugins/{PLUGIN_ID}")
        assert resp.ok or resp.status == 404, (
            f"plugin unload failed [{resp.status}]"
        )

        log_test_result(test_name, True, 0)
