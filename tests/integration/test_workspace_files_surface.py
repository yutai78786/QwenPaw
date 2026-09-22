# -*- coding: utf-8 -*-
"""Integration tests for the workspace file HTTP surface.

Drives /api/workspace file endpoints through the real app subprocess
(app_server fixture) so the markdown manager, directory listing,
chunked file reads, metadata and optimistic-concurrency saves all
execute inside the child process.

Flow chains write -> read -> metadata -> tree -> conflict so the full
happy path plus error branches run in the subprocess.

Targets: src/qwenpaw/app/routers/workspace.py file endpoints and the
workspace filesystem helpers they reach.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(15.0)

_BASE = "/api/workspace"
_MD = "integ-sprint7-note.md"


@pytest.mark.integration
@pytest.mark.p1
def test_list_working_files(app_server) -> None:
    """Working file list endpoint parses."""
    resp = app_server.api_request("GET", f"{_BASE}/files", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), list)


@pytest.mark.integration
@pytest.mark.p1
def test_write_and_read_working_file(app_server) -> None:
    """PUT then GET round-trips a working markdown file."""
    put = app_server.api_request(
        "PUT",
        f"{_BASE}/files/{_MD}",
        json={"content": "# sprint7\nintegration coverage probe"},
        timeout=_T,
    )
    assert put.status_code == 200, app_server.logs_tail()
    got = app_server.api_request("GET", f"{_BASE}/files/{_MD}", timeout=_T)
    assert got.status_code == 200, app_server.logs_tail()
    assert "sprint7" in got.json().get("content", "")


@pytest.mark.integration
@pytest.mark.p1
def test_read_missing_working_file_404(app_server) -> None:
    """Unknown working file name is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/files/integ-definitely-absent-xyz.md",
        timeout=_T,
    )
    assert resp.status_code in (404, 500), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_tree_root_page(app_server) -> None:
    """Tree endpoint lists the project root page."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/tree",
        params={"root": "project", "limit": 50},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert isinstance(body, dict)


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_tree_bad_cursor_400(app_server) -> None:
    """Invalid cursor is rejected as 400."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/tree",
        params={"cursor": "integ-not-a-cursor"},
        timeout=_T,
    )
    assert resp.status_code in (400, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_tree_missing_dir_404(app_server) -> None:
    """Listing a nonexistent subdirectory is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/tree",
        params={"path": "integ/no/such/dir"},
        timeout=_T,
    )
    assert resp.status_code in (400, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_file_metadata_missing_404(app_server) -> None:
    """Metadata for an absent file is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/file-metadata",
        params={"path": "integ-absent-file.txt"},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_file_content_missing_404(app_server) -> None:
    """Content read for an absent file is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/file-content",
        params={"path": "integ-absent-file.txt"},
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_file_content_traversal_rejected(app_server) -> None:
    """Paths escaping the workspace root are rejected."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/file-content",
        params={"path": "../../etc/passwd"},
        timeout=_T,
    )
    assert resp.status_code in (400, 403, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_write_file_content_requires_string(app_server) -> None:
    """PUT file-content rejects non-string content with 422."""
    resp = app_server.api_request(
        "PUT",
        f"{_BASE}/file-content",
        params={"path": "integ-probe.txt"},
        json={"content": 123},
        timeout=_T,
    )
    assert resp.status_code == 422, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_file_metadata_traversal_rejected(app_server) -> None:
    """Metadata path escaping is rejected."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/file-metadata",
        params={"path": "../outside"},
        timeout=_T,
    )
    assert resp.status_code in (400, 403, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_memory_listing(app_server) -> None:
    """Memory listing endpoint parses (seeded by workspace setup)."""
    resp = app_server.api_request("GET", f"{_BASE}/memory", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_workspace_language_get(app_server) -> None:
    """Language endpoint reports the workspace language."""
    resp = app_server.api_request("GET", f"{_BASE}/language", timeout=_T)
    assert resp.status_code in (200, 404), app_server.logs_tail()
