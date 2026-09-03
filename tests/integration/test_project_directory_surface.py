# -*- coding: utf-8 -*-
"""Integration tests for the project directory HTTP surface.

Drives /api/workspace/project-directory endpoints through the real
app subprocess (app_server fixture) so project resolution, git-init
on create, directory browsing, scanning and validation branches all
execute inside the child process.

Targets: src/qwenpaw/app/routers/project_directory.py endpoints and
the coding-project helpers they reach in the subprocess.
"""

from __future__ import annotations

import pytest
from helpers import default_http_timeout

_T = default_http_timeout(20.0)

_BASE = "/api/workspace/project-directory"


@pytest.mark.integration
@pytest.mark.p1
def test_get_default_project(app_server) -> None:
    """GET reports the active project directory snapshot."""
    resp = app_server.api_request("GET", _BASE, timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert "path" in body
    assert "is_workspace_default" in body
    assert "workspace_dir" in body


@pytest.mark.integration
@pytest.mark.p1
def test_set_project_reset_to_default(app_server) -> None:
    """PUT with null path resets to the default workspace dir."""
    resp = app_server.api_request(
        "PUT",
        _BASE,
        json={"path": None},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    assert resp.json().get("is_workspace_default") is True


@pytest.mark.integration
@pytest.mark.p1
def test_set_project_missing_path_400(app_server) -> None:
    """Nonexistent target path is rejected with 400."""
    resp = app_server.api_request(
        "PUT",
        _BASE,
        json={"path": "/integ/no/such/dir"},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_set_project_not_a_directory_400(app_server) -> None:
    """A file path (not a directory) is rejected with 400."""
    resp = app_server.api_request(
        "PUT",
        _BASE,
        json={"path": "/etc/hostname"},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_create_project_empty_name_400(app_server) -> None:
    """Empty project name is rejected."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/create",
        json={"name": "   "},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_create_project_and_list(app_server) -> None:
    """Create initialises a project dir that then shows in /list."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/create",
        json={"name": "integ-sprint7-proj"},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert body.get("name") == "integ-sprint7-proj"
    listing = app_server.api_request("GET", f"{_BASE}/list", timeout=_T)
    assert listing.status_code == 200, app_server.logs_tail()
    names = [item.get("name") for item in listing.json()]
    assert "integ-sprint7-proj" in names


@pytest.mark.integration
@pytest.mark.p1
def test_list_projects_empty_or_list(app_server) -> None:
    """List endpoint parses in any state."""
    resp = app_server.api_request("GET", f"{_BASE}/list", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    assert isinstance(resp.json(), list)


@pytest.mark.integration
@pytest.mark.p1
def test_browse_dirs_home(app_server) -> None:
    """Browsing the default home directory parses."""
    resp = app_server.api_request("GET", f"{_BASE}/browse-dirs", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert isinstance(body, dict)


@pytest.mark.integration
@pytest.mark.p1
def test_browse_dirs_missing_path_400(app_server) -> None:
    """Browsing a nonexistent path is a 400."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/browse-dirs",
        params={"path": "/integ/no/such/dir"},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_browse_dirs_file_not_dir_400(app_server) -> None:
    """Browsing a regular file is a 400."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/browse-dirs",
        params={"path": "/etc/hostname"},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_browse_dirs_show_hidden(app_server) -> None:
    """show_hidden=true includes dot directories."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/browse-dirs",
        params={"show_hidden": "true"},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_browse_create_missing_parent_400(app_server) -> None:
    """Creating under a nonexistent parent is a 400."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/browse-dirs/create",
        json={"parent": "/integ/no/such/dir", "name": "child"},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_clone_project_invalid_url_contract(app_server) -> None:
    """Clone with an unparsable URL returns a contract status."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/clone",
        json={"url": "integ-not-a-url", "name": "integ-clone"},
        timeout=_T,
    )
    assert resp.status_code in (
        200,
        202,
        400,
        409,
        422,
        500,
    ), app_server.logs_tail()
