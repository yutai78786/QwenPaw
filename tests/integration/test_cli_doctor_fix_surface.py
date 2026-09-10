# -*- coding: utf-8 -*-
"""Integration tests for ``qwenpaw doctor fix`` driven end-to-end.

These cases run the real CLI as a subprocess against the module's
app-server workspace and assert on observable command behaviour:
what ``--dry-run`` plans, what ``--yes`` changes on disk, the backup
session it creates, and how ``--only`` / ``--non-interactive`` gate the
fix ids. They replace a former ``*_module.py`` file that imported the
runner's private helpers (``_parse_only``, ``_atomic_write_text``,
``PlannedFix``, ...) and called them in the pytest process — valid unit
coverage, but invisible to the integration metric, which only counts
code executed inside a subprocess. Those helpers are already covered by
``tests/unit/cli/test_doctor_fix_runner.py``; this file deliberately
tests the *command wiring* instead, which unit tests cannot reach.

Isolation rules:

* Broken-state scenarios mutate the app-server's real ``default``
  workspace (``doctor fix`` only scans registered workspaces), so every
  case that writes backs up the target first and restores it in a
  ``finally`` block. ``agent.json`` is watched by ``AgentConfigWatcher``
  and restored immediately to avoid a reload race leaking into siblings.
* ``rebuild-console-npm`` is never applied (it runs real npm); the
  ``reconcile-workspace-skills`` apply path is never run (it blocks on
  confirmation). Only ``--dry-run`` / safe / read-only / bounded
  ``--yes`` paths are exercised.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest
from helpers import run_cli

_CLI_TIMEOUT = 90.0


def _cli_env(app_server, home: Path) -> dict[str, str]:
    return {
        "QWENPAW_WORKING_DIR": str(app_server.working_dir),
        "QWENPAW_SECRET_DIR": str(home / "secret"),
        "QWENPAW_AUTH_ENABLED": "false",
        "QWENPAW_RUNNING_IN_CONTAINER": "true",
        "PYTHONIOENCODING": "utf-8",
        "NO_PROXY": "*",
    }


def _fix(app_server, home: Path, *args: str):
    """Run ``qwenpaw doctor fix <args>`` against this app server."""
    return run_cli(
        "--host",
        app_server.host,
        "--port",
        str(app_server.port),
        "doctor",
        "fix",
        *args,
        timeout=_CLI_TIMEOUT,
        home=home,
        extra_env=_cli_env(app_server, home),
    )


def _default_ws(app_server) -> Path:
    return app_server.working_dir / "workspaces" / "default"


def _full_job(job_id: str, cron: str, name: str = "probe") -> dict:
    """A complete, schema-valid cron job (JobsFile requires all of these)."""
    return {
        "id": job_id,
        "name": name,
        "enabled": False,
        "schedule": {"type": "cron", "cron": cron, "timezone": "UTC"},
        "task_type": "agent",
        "request": {"input": {"type": "text", "text": "rewrite probe"}},
        "dispatch": {
            "type": "channel",
            "channel": "console",
            "target": {
                "user_id": "probe-user",
                "session_id": f"console:{job_id}",
            },
            "mode": "stream",
        },
    }


def _backup_dirs(app_server) -> list[Path]:
    root = app_server.working_dir
    return [root / "doctor-fix-backups", *_subdir_backups(root)]


def _subdir_backups(root: Path) -> list[Path]:
    return list(root.rglob("doctor-fix-backups"))


@pytest.fixture(name="clean_state")
def _clean_state(app_server):
    """Snapshot default workspace files, restore them after the test."""
    ws = _default_ws(app_server)
    watched = ["agent.json", "jobs.json"]
    saved = {}
    for name in watched:
        p = ws / name
        saved[name] = p.read_bytes() if p.exists() else None
    yield ws
    for name, blob in saved.items():
        p = ws / name
        if blob is None:
            p.unlink(missing_ok=True)
        else:
            p.write_bytes(blob)
    for bkp in _backup_dirs(app_server):
        shutil.rmtree(bkp, ignore_errors=True)


# ------------------------------------------------------------------ #
# healthy state
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_dry_run_on_healthy_workspace_is_noop(app_server, tmp_path) -> None:
    """A clean workspace plans nothing and changes nothing."""
    before = _default_ws(app_server) / "agent.json"
    digest = before.read_bytes()

    result = _fix(app_server, tmp_path, "--dry-run")
    assert result.returncode == 0, result.stderr
    assert "Nothing to do" in result.stdout, result.stdout
    assert before.read_bytes() == digest


# ------------------------------------------------------------------ #
# invalid agent.json -> reset-invalid-agent-json
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_dry_run_flags_invalid_agent_json(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """Broken agent.json is reported by dry-run without being touched."""
    target = clean_state / "agent.json"
    target.write_text("{ this is not json", encoding="utf-8")

    result = _fix(
        app_server,
        tmp_path,
        "--dry-run",
        "--only",
        "reset-invalid-agent-json",
    )
    assert result.returncode == 0, result.stderr
    assert "reset-invalid-agent-json" in result.stdout, result.stdout
    assert "Planned operations" in result.stdout, result.stdout
    # Dry run must not repair the file.
    assert target.read_text(encoding="utf-8") == "{ this is not json"


@pytest.mark.integration
@pytest.mark.p1
def test_yes_repairs_invalid_agent_json_and_backs_up(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """``--yes`` replaces the broken file and keeps a backup copy."""
    target = clean_state / "agent.json"
    broken = "{ this is not json"
    target.write_text(broken, encoding="utf-8")

    result = _fix(
        app_server,
        tmp_path,
        "--yes",
        "--only",
        "reset-invalid-agent-json",
    )
    assert result.returncode == 0, result.stderr

    # The file is valid JSON again.
    repaired = json.loads(target.read_text(encoding="utf-8"))
    assert isinstance(repaired, dict), repaired

    # A backup session captured the broken original.
    backups = _backup_dirs(app_server)
    assert backups, "no doctor-fix-backups dir created"
    captured = [
        p
        for bkp in backups
        for p in bkp.rglob("agent.json")
        if p.read_text(encoding="utf-8", errors="replace") == broken
    ]
    assert captured, [str(p) for bkp in backups for p in bkp.rglob("*")]


# ------------------------------------------------------------------ #
# jobs.json cron normalization / creation / validation
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_dry_run_flags_invalid_cron(app_server, tmp_path, clean_state) -> None:
    """A non-parseable cron expression is surfaced as a note."""
    jobs = clean_state / "jobs.json"
    jobs.write_text(
        json.dumps({"jobs": [{"id": "bad-1", "schedule": {"cron": "nope"}}]}),
        encoding="utf-8",
    )

    result = _fix(
        app_server,
        tmp_path,
        "--dry-run",
        "--only",
        "normalize-jobs-cron",
    )
    assert result.returncode == 0, result.stderr
    assert "bad-1" in result.stdout, result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_yes_normalizes_numeric_day_of_week(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """Numeric day-of-week is rewritten to its name by the real fixer."""
    jobs = clean_state / "jobs.json"
    jobs.write_text(
        json.dumps({"jobs": [_full_job("j-1", "0 8 * * 1")]}),
        encoding="utf-8",
    )

    result = _fix(
        app_server,
        tmp_path,
        "--yes",
        "--only",
        "normalize-jobs-cron",
    )
    assert result.returncode == 0, result.stderr
    data = json.loads(jobs.read_text(encoding="utf-8"))
    cron = data["jobs"][0]["schedule"]["cron"]
    # ScheduleSpec normalizes numeric dow 1 -> "mon".
    assert cron == "0 8 * * mon", cron


@pytest.mark.integration
@pytest.mark.p1
def test_yes_writes_missing_jobs_json(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """A missing jobs.json is created empty by write-empty-jobs-json."""
    jobs = clean_state / "jobs.json"
    jobs.unlink(missing_ok=True)

    result = _fix(
        app_server,
        tmp_path,
        "--yes",
        "--only",
        "write-empty-jobs-json",
    )
    assert result.returncode == 0, result.stderr
    assert jobs.exists(), "jobs.json was not created"
    data = json.loads(jobs.read_text(encoding="utf-8"))
    assert data.get("jobs") == [], data


@pytest.mark.integration
@pytest.mark.p1
def test_validate_jobs_json_is_readonly(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """The read-only validator reports but never rewrites jobs.json."""
    jobs = clean_state / "jobs.json"
    payload = {"jobs": [_full_job("v-1", "0 0 * * *", "validate probe")]}
    jobs.write_text(json.dumps(payload), encoding="utf-8")
    digest = jobs.read_bytes()

    result = _fix(
        app_server,
        tmp_path,
        "--dry-run",
        "--only",
        "validate-all-jobs-json",
    )
    assert result.returncode == 0, result.stderr
    assert jobs.read_bytes() == digest


# ------------------------------------------------------------------ #
# argument gating
# ------------------------------------------------------------------ #


@pytest.mark.integration
@pytest.mark.p1
def test_only_filters_to_requested_ids(
    app_server,
    tmp_path,
    clean_state,
) -> None:
    """``--only`` runs just the named fix and ignores the rest."""
    (clean_state / "agent.json").write_text("{ broken", encoding="utf-8")
    (clean_state / "jobs.json").unlink(missing_ok=True)

    result = _fix(
        app_server,
        tmp_path,
        "--dry-run",
        "--only",
        "reset-invalid-agent-json",
    )
    assert result.returncode == 0, result.stderr
    # The jobs.json fix must not appear when only agent-json was requested.
    assert "write-empty-jobs-json" not in result.stdout, result.stdout
    assert "reset-invalid-agent-json" in result.stdout, result.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_unknown_only_id_is_rejected(app_server, tmp_path) -> None:
    """An unrecognized fix id fails and lists the known ids."""
    result = _fix(app_server, tmp_path, "--dry-run", "--only", "no-such-fix")
    assert result.returncode != 0, result.stdout
    combined = result.stdout + result.stderr
    assert "no-such-fix" in combined, combined
    assert "reset-invalid-agent-json" in combined, combined


@pytest.mark.integration
@pytest.mark.p1
def test_non_interactive_rejects_risky_ids(app_server, tmp_path) -> None:
    """``--non-interactive`` refuses risky fixes even with ``-y``."""
    result = _fix(
        app_server,
        tmp_path,
        "--non-interactive",
        "--only",
        "normalize-jobs-cron",
        "-y",
    )
    assert result.returncode != 0, result.stdout
    combined = result.stdout + result.stderr
    assert "normalize-jobs-cron" in combined, combined


@pytest.mark.integration
@pytest.mark.p1
def test_non_interactive_allows_readonly_ids(app_server, tmp_path) -> None:
    """``--non-interactive`` accepts read-only validation."""
    result = _fix(
        app_server,
        tmp_path,
        "--non-interactive",
        "--only",
        "validate-all-jobs-json",
    )
    assert result.returncode == 0, result.stderr
