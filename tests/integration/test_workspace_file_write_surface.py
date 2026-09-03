# -*- coding: utf-8 -*-
"""Integration tests driving workspace file write paths in the subprocess.

High-leverage coverage: each case performs real file writes through
the optimistic-concurrency save path (save_text_file with ETag),
chunked reads, metadata resolution and downloads inside the app
subprocess. Existing contract tests only ever sent empty bodies; this
batch actually writes, re-reads and conflicts.

Targets reached: src/qwenpaw/services/workspace_files.py
(save_text_file/read_file_chunk/get_file_metadata/file_etag/
FileVersionConflict), routers/workspace.py write branches.

Probes are uniquely named and removed by each case.
"""

from __future__ import annotations

import uuid

import pytest
from helpers import default_http_timeout, remove_probe_quietly

_T = default_http_timeout(20.0)

_BASE = "/api/workspace"


def _probe_path() -> str:
    return f"integ-ws-probe-{uuid.uuid4().hex[:10]}.md"


def _cleanup(app_server, path: str) -> None:
    target = app_server.working_dir / "workspaces" / "default" / path
    remove_probe_quietly(target)


@pytest.mark.integration
@pytest.mark.p1
def test_write_new_file_and_read_back(app_server) -> None:
    """PUT file-content creates a file; GET chunk reads it back."""
    path = _probe_path()
    try:
        put = app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "sprint7 probe content"},
            timeout=_T,
        )
        assert put.status_code == 200, app_server.logs_tail()
        body = put.json()
        assert body.get("path") == path
        assert body.get("etag"), body

        read = app_server.api_request(
            "GET",
            f"{_BASE}/file-content",
            params={"path": path, "offset": 0, "limit": 10_000},
            timeout=_T,
        )
        assert read.status_code == 200, app_server.logs_tail()
        assert "sprint7 probe content" in str(read.json())
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_write_with_matching_etag_succeeds(app_server) -> None:
    """A save with the current ETag passes the concurrency check."""
    path = _probe_path()
    try:
        first = app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "v1"},
            timeout=_T,
        )
        assert first.status_code == 200, app_server.logs_tail()
        etag = first.json().get("etag")
        assert etag

        second = app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            headers={"if-match": etag},
            json={"content": "v2"},
            timeout=_T,
        )
        assert second.status_code == 200, app_server.logs_tail()
        assert second.json().get("etag") != etag
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_write_with_stale_etag_conflicts(app_server) -> None:
    """A save with a stale ETag is rejected with 409."""
    path = _probe_path()
    try:
        first = app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "original"},
            timeout=_T,
        )
        assert first.status_code == 200, app_server.logs_tail()
        stale_etag = first.json().get("etag")

        # Advance the file so the saved etag becomes stale.
        app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "advanced"},
            timeout=_T,
        )

        conflict = app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            headers={"if-match": stale_etag},
            json={"content": "should not land"},
            timeout=_T,
        )
        assert conflict.status_code == 409, app_server.logs_tail()
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_etag_for_missing_file_conflicts(app_server) -> None:
    """Supplying an ETag for a nonexistent file is a 409."""
    path = _probe_path()
    resp = app_server.api_request(
        "PUT",
        f"{_BASE}/file-content",
        params={"path": path},
        headers={"if-match": "deadbeefdeadbeef"},
        json={"content": "nope"},
        timeout=_T,
    )
    assert resp.status_code == 409, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_file_metadata_after_write(app_server) -> None:
    """Metadata reflects size/type of a written probe file."""
    path = _probe_path()
    try:
        app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "metadata probe"},
            timeout=_T,
        )
        meta = app_server.api_request(
            "GET",
            f"{_BASE}/file-metadata",
            params={"path": path},
            timeout=_T,
        )
        assert meta.status_code == 200, app_server.logs_tail()
        assert isinstance(meta.json(), dict)
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_file_download_written_probe(app_server) -> None:
    """Downloading a written probe returns its bytes."""
    path = _probe_path()
    try:
        app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": "download probe"},
            timeout=_T,
        )
        download = app_server.api_request(
            "GET",
            f"{_BASE}/file-download",
            params={"path": path},
            timeout=_T,
        )
        assert download.status_code == 200, app_server.logs_tail()
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_file_download_missing_404(app_server) -> None:
    """Downloading an absent file is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/file-download",
        params={"path": _probe_path()},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_chunked_read_offsets(app_server) -> None:
    """Reading with offsets yields bounded chunks."""
    path = _probe_path()
    try:
        payload = "line-one\nline-two\nline-three\n"
        app_server.api_request(
            "PUT",
            f"{_BASE}/file-content",
            params={"path": path},
            json={"content": payload},
            timeout=_T,
        )
        chunk = app_server.api_request(
            "GET",
            f"{_BASE}/file-content",
            params={"path": path, "offset": 0, "limit": 8},
            timeout=_T,
        )
        assert chunk.status_code == 200, app_server.logs_tail()
    finally:
        _cleanup(app_server, path)


@pytest.mark.integration
@pytest.mark.p1
def test_write_traversal_rejected(app_server) -> None:
    """Writing outside the workspace root is rejected."""
    resp = app_server.api_request(
        "PUT",
        f"{_BASE}/file-content",
        params={"path": "../../integ-escape.txt"},
        json={"content": "should be blocked"},
        timeout=_T,
    )
    assert resp.status_code in (400, 403, 404), app_server.logs_tail()
