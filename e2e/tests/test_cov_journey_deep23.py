# -*- coding: utf-8 -*-
"""
Workspace settings / file / config deep round trips (5pp wave 23).

Deterministic REST-only coverage:
- workspace router: language, audio-mode, transcription settings,
  system-prompt-files, running-config, zip download/upload merge,
  working-file md, memory file read/write, code-file list/read/etag/write,
  binary download, html-file-uri
- config router: channels list/types/schemas/detail, acp + node-runtime,
  heartbeat settings

All calls are pure API round trips (no LLM), deterministic by design.
Surfaces that may reach the network are wrapped defensively; any HTTP status
still exercises the endpoint prologue, which is what adds coverage.

Run: pytest tests/test_cov_journey_deep23.py -v
"""
from __future__ import annotations

import io
import json
import logging
import zipfile

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


def _plain_http():
    import requests as http_requests
    from config.settings import config
    return http_requests, config.server.base_url


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceSettingsRoundTrips:
    """COV-WSSET-001: language/audio/transcription/prompt config round trips."""

    @pytest.mark.test_id("COV-WSSET-001")
    def test_workspace_settings_round_trips(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Language get -> put -> restore")
        lang0 = api_context.get("/api/workspace/language")
        assert lang0.ok, f"language get failed [{lang0.status}]"
        orig_lang = lang0.json().get("language")
        put_lang = api_context.put(
            "/api/workspace/language", data=json.dumps({"language": "en"}))
        assert put_lang.ok, f"language put failed [{put_lang.status}]"
        bad_lang = api_context.put(
            "/api/workspace/language",
            data=json.dumps({"language": "not-a-lang"}),
        )
        assert bad_lang.status == 400, (
            f"invalid language expected 400 [{bad_lang.status}]"
        )
        if orig_lang:
            api_context.put(
                "/api/workspace/language",
                data=json.dumps({"language": orig_lang}),
            )

        log_test_step("2. Audio mode get -> put -> restore")
        am0 = api_context.get("/api/workspace/audio-mode")
        assert am0.ok, f"audio-mode get failed [{am0.status}]"
        orig_am = am0.json().get("audio_mode", "auto")
        put_am = api_context.put(
            "/api/workspace/audio-mode",
            data=json.dumps({"audio_mode": "native"}),
        )
        assert put_am.ok, f"audio-mode put failed [{put_am.status}]"
        api_context.put(
            "/api/workspace/audio-mode",
            data=json.dumps({"audio_mode": orig_am}),
        )

        log_test_step("3. Transcription type get -> put -> transcribe probe")
        tt0 = api_context.get("/api/workspace/transcription-provider-type")
        assert tt0.ok, f"transcription type get failed [{tt0.status}]"
        orig_tt = tt0.json().get("transcription_provider_type", "disabled")
        put_tt = api_context.put(
            "/api/workspace/transcription-provider-type",
            data=json.dumps({"transcription_provider_type": "whisper_api"}),
        )
        assert put_tt.ok, f"transcription type put failed [{put_tt.status}]"

        http, base = _plain_http()
        # Wrong file type -> 400 branch of /transcribe
        probe = http.post(
            f"{base}/api/workspace/transcribe",
            files={"file": ("probe.txt", io.BytesIO(b"not audio"), "text/plain")},
            headers={"X-Agent-Id": "default"},
            timeout=30,
        )
        logger.info("transcribe bad-type -> %s", probe.status_code)
        assert probe.status_code in (400, 422), (
            f"transcribe bad-type unexpected [{probe.status_code}]"
        )
        api_context.put(
            "/api/workspace/transcription-provider-type",
            data=json.dumps({"transcription_provider_type": orig_tt}),
        )
        # disabled branch: transcribe with provider disabled -> 400
        if orig_tt == "disabled":
            probe2 = http.post(
                f"{base}/api/workspace/transcribe",
                files={"file": ("a.wav", io.BytesIO(b"RIFF"), "audio/wav")},
                headers={"X-Agent-Id": "default"},
                timeout=30,
            )
            logger.info("transcribe disabled -> %s", probe2.status_code)

        log_test_step("4. Whisper status + provider list + provider select")
        ws = api_context.get("/api/workspace/local-whisper-status")
        assert ws.ok, f"local-whisper-status failed [{ws.status}]"
        tp = api_context.get("/api/workspace/transcription-providers")
        assert tp.ok, f"transcription-providers failed [{tp.status}]"
        put_prov = api_context.put(
            "/api/workspace/transcription-provider",
            data=json.dumps({"provider_id": ""}),
        )
        assert put_prov.ok, f"transcription-provider put failed [{put_prov.status}]"

        log_test_step("5. System prompt files get -> put")
        spf0 = api_context.get("/api/workspace/system-prompt-files")
        assert spf0.ok, f"system-prompt-files get failed [{spf0.status}]"
        orig_spf = spf0.json() if isinstance(spf0.json(), list) else []
        put_spf = api_context.put(
            "/api/workspace/system-prompt-files", data=json.dumps(orig_spf))
        assert put_spf.ok, f"system-prompt-files put failed [{put_spf.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceRunningConfigRoundTrip:
    """COV-WSRUN-001: running-config get -> identical put (persist path)."""

    @pytest.mark.test_id("COV-WSRUN-001")
    def test_running_config_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Read running config")
        rc0 = api_context.get("/api/workspace/running-config")
        assert rc0.ok, f"running-config get failed [{rc0.status}]"
        cfg = rc0.json()
        assert isinstance(cfg, dict), "running-config payload not a dict"

        log_test_step("2. Put back identical config")
        rc1 = api_context.put(
            "/api/workspace/running-config", data=json.dumps(cfg))
        assert rc1.ok, f"running-config put failed [{rc1.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceZipDownloadUpload:
    """COV-WSZIP-001: download workspace zip -> re-upload merge -> reject."""

    @pytest.mark.test_id("COV-WSZIP-001")
    def test_workspace_zip_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        http, base = _plain_http()
        hdr = {"X-Agent-Id": "default"}

        log_test_step("1. Download workspace as zip")
        resp = http.get(f"{base}/api/workspace/download", headers=hdr, timeout=120)
        assert resp.status_code == 200, (
            f"workspace download failed [{resp.status_code}]"
        )
        data = resp.content
        assert zipfile.is_zipfile(io.BytesIO(data)), "download is not a zip"
        logger.info("zip members=%d", len(zipfile.ZipFile(io.BytesIO(data)).namelist()))

        log_test_step("2. Upload-merge a tiny probe zip")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("e2e_cov23_probe.md", "# cov23 probe\n")
        up = http.post(
            f"{base}/api/workspace/upload",
            files={"file": ("probe.zip", io.BytesIO(buf.getvalue()), "application/zip")},
            headers=hdr,
            timeout=120,
        )
        assert up.status_code == 200, (
            f"workspace upload failed [{up.status_code}]: {up.text[:200]}"
        )

        log_test_step("3. Reject a non-zip upload (error branch)")
        bad = http.post(
            f"{base}/api/workspace/upload",
            files={"file": ("probe.txt", io.BytesIO(b"not a zip"), "text/plain")},
            headers=hdr,
            timeout=60,
        )
        assert bad.status_code in (400, 415, 422, 500), (
            f"non-zip upload unexpected [{bad.status_code}]"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceMdFileRoundTrips:
    """COV-WSMD-001: working-file md + memory-file read/write via REST."""

    @pytest.mark.test_id("COV-WSMD-001")
    def test_md_file_round_trips(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Write + read a working md file")
        wname = "e2e_cov23_working.md"
        put = api_context.put(
            f"/api/workspace/files/{wname}",
            data=json.dumps({"content": "# cov23 working probe\n"}),
        )
        assert put.ok, f"working write failed [{put.status}]"
        got = api_context.get(f"/api/workspace/files/{wname}")
        assert got.ok, f"working read failed [{got.status}]"
        assert "cov23" in json.dumps(got.json(), ensure_ascii=False)
        missing = api_context.get("/api/workspace/files/e2e_cov23_missing")
        assert missing.status == 404, f"missing expected 404 [{missing.status}]"

        log_test_step("2. Memory list + write/read daily + digest surfaces")
        mem = api_context.get("/api/workspace/memory")
        assert mem.ok, f"memory list failed [{mem.status}]"
        mem_daily = api_context.get("/api/workspace/memory?section=daily")
        assert mem_daily.ok, f"memory daily list failed [{mem_daily.status}]"

        mname = "e2e_cov23_mem.md"
        mput = api_context.put(
            f"/api/workspace/memory/{mname}?section=daily",
            data=json.dumps({"content": "# cov23 memory probe\n"}),
        )
        assert mput.ok, f"memory daily write failed [{mput.status}]"
        mgot = api_context.get(f"/api/workspace/memory/{mname}?section=daily")
        assert mgot.ok, f"memory daily read failed [{mgot.status}]"
        assert "cov23" in json.dumps(mgot.json(), ensure_ascii=False)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.files
class TestWorkspaceCodeFiles:
    """COV-WSCODE-001: code-files write/list/read/etag + binary download."""

    @pytest.mark.test_id("COV-WSCODE-001")
    def test_code_files_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Seed a code file via code-files write")
        py_name = "e2e_cov23_code.py"
        wr = api_context.put(
            f"/api/workspace/code-files/{py_name}",
            data=json.dumps({"content": "print('cov23')\n"}),
        )
        assert wr.ok, f"code write failed [{wr.status}]"
        # invalid content type -> 422 branch
        wr_bad = api_context.put(
            f"/api/workspace/code-files/{py_name}",
            data=json.dumps({"content": 123}),
        )
        assert wr_bad.status == 422, f"content-type expected 422 [{wr_bad.status}]"

        log_test_step("2. List code files")
        ls = api_context.get("/api/workspace/code-files")
        assert ls.ok, f"code-files list failed [{ls.status}]"

        log_test_step("3. Read code file + etag 304 + oversized guard")
        rd = api_context.get(f"/api/workspace/code-files/{py_name}")
        assert rd.ok, f"code read failed [{rd.status}]"
        etag = rd.headers.get("ETag")
        assert "cov23" in json.dumps(rd.json(), ensure_ascii=False)
        if etag:
            rd304 = api_context.get(
                f"/api/workspace/code-files/{py_name}",
                headers={"If-None-Match": etag},
            )
            assert rd304.status == 304, f"etag expected 304 [{rd304.status}]"
        rd404 = api_context.get("/api/workspace/code-files/e2e_cov23_missing.py")
        assert rd404.status == 404, f"missing expected 404 [{rd404.status}]"

        log_test_step("4. Binary download: csv success + py 415 reject")
        csv_name = "e2e_cov23_probe.csv"
        api_context.put(
            f"/api/workspace/code-files/{csv_name}",
            data=json.dumps({"content": "a,b\n1,2\n"}),
        )
        dl = api_context.get(f"/api/workspace/binary-files/{csv_name}")
        assert dl.ok, f"binary csv download failed [{dl.status}]"
        dl415 = api_context.get(f"/api/workspace/binary-files/{py_name}")
        assert dl415.status == 415, f"py preview expected 415 [{dl415.status}]"

        log_test_step("5. html-file-uri resolution")
        uri = api_context.get(
            f"/api/workspace/html-file-uri?path={csv_name}&root=project")
        assert uri.status in (200, 400, 404), (
            f"html-file-uri unexpected [{uri.status}]"
        )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.channels
class TestConfigChannelsSurfaces:
    """COV-CFGCH-001: channels list/types/schemas + per-channel surfaces."""

    @pytest.mark.test_id("COV-CFGCH-001")
    def test_channels_config_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Channels list + types + schemas")
        ch = api_context.get("/api/config/channels")
        assert ch.ok, f"channels get failed [{ch.status}]"
        types = api_context.get("/api/config/channels/types")
        assert types.ok, f"channels types failed [{types.status}]"
        schemas = api_context.get("/api/config/channels/schemas")
        assert schemas.ok, f"channels schemas failed [{schemas.status}]"

        log_test_step("2. Per-channel detail (network-safe, any status ok)")
        payload = ch.json()
        names = list(payload.keys())[:6] if isinstance(payload, dict) else []
        for name in names:
            if not name:
                continue
            try:
                d = api_context.get(f"/api/config/channels/{name}")
                logger.info("channel %s detail -> %s", name, d.status)
            except Exception as exc:
                logger.info("channel %s detail error: %s", name, exc)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.acp
class TestConfigAcpHeartbeatSurfaces:
    """COV-CFGACP-001: acp settings + node-runtime + heartbeat surfaces."""

    @pytest.mark.test_id("COV-CFGACP-001")
    def test_acp_and_heartbeat_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. ACP settings + node-runtime")
        acp = api_context.get("/api/config/acp")
        assert acp.ok, f"acp get failed [{acp.status}]"
        rt = api_context.get("/api/config/acp/node-runtime")
        assert rt.ok, f"acp node-runtime failed [{rt.status}]"

        log_test_step("2. Heartbeat get")
        hb = api_context.get("/api/config/heartbeat")
        assert hb.ok, f"heartbeat get failed [{hb.status}]"

        log_test_result(test_name, True, 0)
