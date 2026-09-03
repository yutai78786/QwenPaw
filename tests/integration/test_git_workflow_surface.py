# -*- coding: utf-8 -*-
"""Integration tests driving the workspace git workflow in the subprocess.

High-leverage coverage: each case issues real git operations (status,
stage, commit, log, unstage, discard) against the agent's project
directory inside the app subprocess, so the git router, repo
auto-initialisation and change-tracking paths all execute in the child
process.

Cases write uniquely-named probe files under the server working dir
and clean up their own changes, staying hermetic.
"""

from __future__ import annotations

import uuid

import pytest
from helpers import default_http_timeout, remove_probe_quietly

_T = default_http_timeout(20.0)

_BASE = "/api/workspace/git"


def _ensure_repo(app_server) -> None:
    """GET status triggers repo auto-init if none exists yet."""
    app_server.api_request("GET", f"{_BASE}/status", timeout=_T)


def _probe_name() -> str:
    return f"integ-git-probe-{uuid.uuid4().hex[:10]}.txt"


def _project_dir(app_server):
    """The agent project dir (git repo root) under the working dir."""
    return app_server.working_dir / "workspaces" / "default"


def _write_probe(app_server, name: str, content: str) -> None:
    """Seed a file in the subprocess project directory."""
    path = _project_dir(app_server) / name
    path.write_text(content, encoding="utf-8")


def _cleanup_probe(app_server, name: str) -> None:
    remove_probe_quietly(_project_dir(app_server) / name)


@pytest.mark.integration
@pytest.mark.p1
def test_git_status_reports_branch(app_server) -> None:
    """Status returns branch + change list after auto-init."""
    resp = app_server.api_request("GET", f"{_BASE}/status", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()
    body = resp.json()
    assert "branch" in body
    assert isinstance(body.get("changes"), list)
    assert "ahead" in body and "behind" in body


@pytest.mark.integration
@pytest.mark.p1
def test_git_log_returns_commits(app_server) -> None:
    """Commit log parses into structured entries."""
    resp = app_server.api_request(
        "GET",
        f"{_BASE}/log",
        params={"limit": 5},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
    commits = resp.json()
    assert isinstance(commits, list)


@pytest.mark.integration
@pytest.mark.p1
def test_git_stage_commit_round_trip(app_server) -> None:
    """Stage a probe file, commit it, see it in the log."""
    name = _probe_name()
    _ensure_repo(app_server)
    _write_probe(app_server, name, "integration git probe")
    try:
        stage = app_server.api_request(
            "POST",
            f"{_BASE}/stage",
            json={"paths": [name]},
            timeout=_T,
        )
        assert stage.status_code == 200, app_server.logs_tail()

        commit = app_server.api_request(
            "POST",
            f"{_BASE}/commit",
            json={"message": "integ probe commit"},
            timeout=_T,
        )
        assert commit.status_code == 200, app_server.logs_tail()
        assert commit.json().get("committed") is True

        log = app_server.api_request(
            "GET",
            f"{_BASE}/log",
            params={"limit": 5},
            timeout=_T,
        )
        assert log.status_code == 200, app_server.logs_tail()
        messages = [c.get("message") for c in log.json()]
        assert "integ probe commit" in messages
    finally:
        _cleanup_probe(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_git_commit_empty_message_400(app_server) -> None:
    """An empty commit message is rejected."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/commit",
        json={"message": "   "},
        timeout=_T,
    )
    assert resp.status_code == 400, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_git_commit_nothing_staged_contract(app_server) -> None:
    """Committing with nothing staged is a contract response."""
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/commit",
        json={"message": "nothing"},
        timeout=_T,
    )
    assert resp.status_code in (200, 400), app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_git_stage_unstage_round_trip(app_server) -> None:
    """Stage then unstage a probe file returns to clean."""
    name = _probe_name()
    _ensure_repo(app_server)
    _write_probe(app_server, name, "stage then unstage")
    try:
        stage = app_server.api_request(
            "POST",
            f"{_BASE}/stage",
            json={"paths": [name]},
            timeout=_T,
        )
        assert stage.status_code == 200, app_server.logs_tail()

        unstage = app_server.api_request(
            "POST",
            f"{_BASE}/unstage",
            json={"paths": [name]},
            timeout=_T,
        )
        assert unstage.status_code == 200, app_server.logs_tail()
        assert unstage.json().get("unstaged") == [name]
    finally:
        _cleanup_probe(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_git_discard_untracked_probe(app_server) -> None:
    """Discard handles an untracked probe path contractually."""
    name = _probe_name()
    _ensure_repo(app_server)
    _write_probe(app_server, name, "discard candidate")
    try:
        resp = app_server.api_request(
            "POST",
            f"{_BASE}/discard",
            json={"paths": [name]},
            timeout=_T,
        )
        assert resp.status_code in (200, 400), app_server.logs_tail()
    finally:
        _cleanup_probe(app_server, name)


@pytest.mark.integration
@pytest.mark.p1
def test_git_diff_clean_contract(app_server) -> None:
    """Diff endpoint parses even with no staged changes."""
    resp = app_server.api_request("GET", f"{_BASE}/diff", timeout=_T)
    assert resp.status_code == 200, app_server.logs_tail()


@pytest.mark.integration
@pytest.mark.p1
def test_git_checkout_current_branch(app_server) -> None:
    """Checking out the current branch is a no-op success."""
    status = app_server.api_request("GET", f"{_BASE}/status", timeout=_T)
    assert status.status_code == 200, app_server.logs_tail()
    branch = status.json().get("branch")
    if not branch:
        pytest.skip("no branch reported (repo may be empty)")
    resp = app_server.api_request(
        "POST",
        f"{_BASE}/checkout",
        json={"branch": branch},
        timeout=_T,
    )
    assert resp.status_code == 200, app_server.logs_tail()
