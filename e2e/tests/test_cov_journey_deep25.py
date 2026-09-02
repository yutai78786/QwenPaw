# -*- coding: utf-8 -*-
"""
Backup lifecycle REST sweep (5pp wave 25).

Deterministic coverage of backup/ (runner, restore entry, export, import,
trust, models) and its router — via pure REST, no UI timing:
- POST /backups/jobs        -> create job + poll snapshot events
- GET  /backups/{id}        -> detail
- GET  /backups/{id}/export -> zip export
- POST /backups/import      -> re-import the exported zip (trust flow)
- POST /backups/delete      -> cleanup of probe backups
- error branches: unknown id detail/export/restore/cancel

NOTE: this wave never calls the real /restore success path — restore would
mutate the shared E2E instance. Only 4xx validation branches are exercised.

Run: pytest tests/test_cov_journey_deep25.py -v
"""
from __future__ import annotations

import io
import json
import logging
import time
import zipfile

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PROBE_NAME = "e2e-cov25-probe"


def _plain_http():
    import requests as http_requests
    from config.settings import config
    return http_requests, config.server.base_url


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.backups
class TestBackupLifecycleRest:
    """COV-BKREST-001: create -> poll -> detail -> export -> delete."""

    @pytest.mark.test_id("COV-BKREST-001")
    def test_backup_lifecycle_rest(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        http, base = _plain_http()
        hdr = {"X-Agent-Id": "default"}

        log_test_step("1. Start a backup creation job")
        job = api_context.post(
            "/api/backups/jobs",
            data=json.dumps({
                "name": PROBE_NAME,
                "description": "cov25 probe",
                "scope": {
                    "include_agents": True,
                    "include_global_config": True,
                    "include_secrets": False,
                    "include_skill_pool": True,
                },
                "agents": ["default"],
            }),
        )
        assert job.status == 202, f"backup job start [{job.status}]: {job.text()[:200]}"
        snap = job.json()
        job_id = snap.get("job_id")
        assert job_id, f"no job_id in snapshot: {snap}"

        log_test_step("2. Poll job status + active job surface")
        final = None
        for _ in range(40):
            st = api_context.get(f"/api/backups/jobs/{job_id}")
            assert st.ok, f"job poll failed [{st.status}]"
            final = st.json()
            if final.get("status") in ("completed", "failed", "cancelled"):
                break
            act = api_context.get("/api/backups/jobs/active")
            logger.info("active job -> %s", act.status)
            time.sleep(2)
        assert final, "job poll returned nothing"
        assert final.get("status") == "completed", (
            f"backup job not completed: {final}"
        )
        backup_id = final.get("backup_id")
        assert backup_id, f"no backup_id: {final}"

        log_test_step("3. Backup detail")
        det = api_context.get(f"/api/backups/{backup_id}")
        assert det.ok, f"backup detail failed [{det.status}]"

        log_test_step("4. Export backup as zip")
        exp = http.get(
            f"{base}/api/backups/{backup_id}/export",
            headers=hdr, timeout=180,
        )
        assert exp.status_code == 200, f"export failed [{exp.status_code}]"
        zdata = exp.content
        assert zipfile.is_zipfile(io.BytesIO(zdata)), "export not a zip"

        log_test_step("5. Import the exported zip back (trust flow)")
        imp = http.post(
            f"{base}/api/backups/import",
            files={"file": ("cov25_probe.zip", io.BytesIO(zdata), "application/zip")},
            headers=hdr, timeout=180,
        )
        logger.info("import -> %s", imp.status_code)
        assert imp.status_code in (200, 201, 202, 400, 409), (
            f"import unexpected [{imp.status_code}]: {imp.text[:200]}"
        )

        log_test_step("6. List + delete probe backups")
        lst = api_context.get("/api/backups")
        assert lst.ok, f"list failed [{lst.status}]"
        ids = [
            b.get("id") for b in lst.json()
            if PROBE_NAME in (b.get("name") or "")
        ]
        if ids:
            dele = api_context.post(
                "/api/backups/delete", data=json.dumps({"ids": ids}))
            assert dele.ok, f"delete failed [{dele.status}]"
            logger.info("deleted probe backups: %s", ids)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.backups
class TestBackupErrorBranches:
    """COV-BKERR-001: unknown-id detail/export/restore + job cancel 404."""

    @pytest.mark.test_id("COV-BKERR-001")
    def test_backup_error_branches(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        fake = "e2e-cov25-no-such-backup"

        log_test_step("1. Unknown backup detail/export -> 404")
        det = api_context.get(f"/api/backups/{fake}")
        assert det.status == 404, f"detail expected 404 [{det.status}]"
        exp = api_context.get(f"/api/backups/{fake}/export")
        assert exp.status == 404, f"export expected 404 [{exp.status}]"

        log_test_step("2. Restore with bad commit/validation branches")
        bad = api_context.post(
            f"/api/backups/{fake}/restore", data=json.dumps({}))
        assert bad.status in (400, 404, 422), f"restore [{bad.status}]"

        log_test_step("3. Cancel unknown job -> 404")
        cn = api_context.post("/api/backups/jobs/e2e-cov25-none/cancel")
        assert cn.status == 404, f"cancel expected 404 [{cn.status}]"

        log_test_result(test_name, True, 0)
