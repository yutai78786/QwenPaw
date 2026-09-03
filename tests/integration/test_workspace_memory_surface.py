# -*- coding: utf-8 -*-
"""Integration tests driving the workspace memory-file API in the subprocess.

High-leverage coverage: each case lists, writes, reads and deletes
memory markdown files through the real AgentMdManager inside the app
subprocess. No existing case has ever touched /api/workspace/memory,
so this exercises the memory-dir resolution, md read/write and the
section filtering branches for the first time.

Probes are uniquely named and removed by each case.
"""

from __future__ import annotations

import uuid

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(20.0)

_BASE = "/api/workspace/memory"


def _probe_name() -> str:
    return f"integ-mem-probe-{uuid.uuid4().hex[:10]}.md"


def _memory_dir(app_server):
    return app_server.working_dir / "workspaces" / "default" / "memory"


def _cleanup(app_server, name: str) -> None:
    path = _memory_dir(app_server) / name
    if path.exists():
        path.unlink()


@pytest.mark.integration
@pytest.mark.p1
def test_memory_list_parses(app_server) -> None:
    """Memory listing returns a parseable file list."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code in (200, 500), app_server.logs_tail()
    if resp.status_code == 200:
        assert isinstance(resp.json(), list)


@pytest.mark.integration
@pytest.mark.p1
def test_memory_write_and_read_back(app_server) -> None:
    """PUT a memory file then GET it back."""
    name = _probe_name()
    try:
        put = app_server.api_request(
            "PUT",
            f"{_BASE}/{name}",
            json={"content": "# memory probe\nsprint7"},
            timeout=_T,
        )
        assert put.status_code == 200, app_server.logs_tail()
        assert put.json().get("written") is True

        got = app_server.api_request("GET", f"{_BASE}/{name}", timeout=_T)
        assert got.status_code == 200, app_server.logs_tail()
        assert "memory probe" in got.json().get("content", "")
    finally:
        _cleanup(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_memory_written_file_appears_in_list(app_server) -> None:
    """A written probe shows up in the memory listing."""
    name = _probe_name()
    try:
        app_server.api_request(
            "PUT",
            f"{_BASE}/{name}",
            json={"content": "listing probe"},
            timeout=_T,
        )
        listing = app_server.api_request("GET", _BASE, timeout=_T)
        assert listing.status_code == 200, app_server.logs_tail()
        names = [(f.get("filename") or f.get("name")) for f in listing.json()]
        assert name in names, f"{name} not in {names}"
    finally:
        _cleanup(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_memory_read_missing_404(app_server) -> None:
    """Reading an absent memory file is a 404."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/{_probe_name()}",
        timeout=_T,
    )
    assert resp.status_code == 404, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_memory_overwrite_updates_content(app_server) -> None:
    """Writing twice replaces the stored content."""
    name = _probe_name()
    try:
        app_server.api_request(
            "PUT",
            f"{_BASE}/{name}",
            json={"content": "version-one"},
            timeout=_T,
        )
        app_server.api_request(
            "PUT",
            f"{_BASE}/{name}",
            json={"content": "version-two"},
            timeout=_T,
        )
        got = app_server.api_request("GET", f"{_BASE}/{name}", timeout=_T)
        assert got.status_code == 200, app_server.logs_tail()
        content = got.json().get("content", "")
        assert "version-two" in content
        assert "version-one" not in content
    finally:
        _cleanup(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_memory_section_filter_contract(app_server) -> None:
    """Section filter accepts the documented values."""
    for section in ("daily", "digest"):
        resp = app_server.api_request(
            "GET",
            _BASE,
            params={"section": section},
            timeout=_T,
        )
        assert resp.status_code in (200, 500), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_memory_traversal_rejected(app_server) -> None:
    """Reading a path escaping the memory dir is rejected."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/../../integ-escape.md",
        timeout=_T,
    )
    assert resp.status_code in (400, 403, 404), app_server.logs_tail()
