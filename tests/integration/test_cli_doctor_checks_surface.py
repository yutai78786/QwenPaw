# -*- coding: utf-8 -*-
"""Integration tests for ``qwenpaw doctor`` driven end-to-end.

These cases run the real CLI as a subprocess against a throwaway
working directory and assert on the *report the command prints* — which
section appears, which config key it names, whether a malformed file
crashes it. They replace a former ``*_module.py`` file that imported the
helpers (``scan_unknown_config_keys``, ``load_raw_config_dict``,
``environment_summary_lines``, ...) and called them in the pytest
process: valid unit coverage wearing an integration label, invisible to
the integration metric, which only counts code executed inside a
subprocess. Those helpers are already covered by
``tests/unit/cli/test_doctor_checks.py`` (158 cases); this file
deliberately tests the *command wiring* instead — the section layout,
the messages a user actually reads, and the validation short-circuit —
which unit tests cannot reach.

Two helpers the old file called are not reachable through the command at
all and are therefore absent here on purpose:

* ``_url_looks_httpish`` — already asserted in
  ``tests/unit/cli/test_doctor_checks.py``; no config shape routes a
  provider ``base_url`` through it into the report (verified: a bogus
  ``ftp://`` / non-URL ``base_url`` still yields "OK — no custom
  provider configuration warnings").
* ``_windows_long_paths_enabled`` — Windows-only registry probe; off
  Windows it returns ``(None, None)`` and prints nothing.

Isolation rules:

* Every case gets its own ``tmp_path`` working directory. ``cli_sandbox``
  is deliberately *not* used: it is a process-wide shared directory, and
  writing a deliberately-invalid ``config.json`` into it would leak into
  ``test_cli_surface.py`` siblings.
* ``doctor`` probes the API section at the global ``--host``/``--port``.
  Omitting them makes it default to ``127.0.0.1:8088``, which on a
  developer box is the real team service and in CI is nothing — an
  implicit environment dependency that would make the report differ per
  machine. Every case therefore pins an unused local port, and one case
  asserts that pinning actually took effect.
* ``doctor`` never mutates config or files (the command says so itself),
  so nothing needs restoring; a malformed-config case asserts the
  auto-repair warning on *stderr* only.
"""

from __future__ import annotations

import json
import socket
from pathlib import Path

import pytest
from helpers import run_cli

_CLI_TIMEOUT = 90.0

# Sections printed by a healthy run; used to prove the command completed
# the whole report rather than bailing out early.
_EXPECTED_SECTIONS = (
    "=== Environment ===",
    "=== Config ===",
    "=== Agents ===",
    "=== Startup paths ===",
    "=== Console (static files) ===",
    "=== Providers (custom) ===",
    "=== Active LLM ===",
    "=== API ===",
)


def _free_port() -> int:
    """An unused local TCP port, so ``doctor`` cannot reach a real service."""
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _doctor(working_dir: Path, home: Path, *args: str):
    """Run ``qwenpaw doctor`` against a throwaway working directory."""
    return run_cli(
        "--host",
        "127.0.0.1",
        "--port",
        str(_free_port()),
        "doctor",
        *args,
        timeout=_CLI_TIMEOUT,
        home=home,
        extra_env={
            "QWENPAW_WORKING_DIR": str(working_dir),
            "QWENPAW_SECRET_DIR": str(home / "secret"),
            "QWENPAW_AUTH_ENABLED": "false",
            "QWENPAW_RUNNING_IN_CONTAINER": "true",
            "PYTHONIOENCODING": "utf-8",
            "NO_PROXY": "*",
        },
    )


def _write_config(working_dir: Path, payload: object) -> Path:
    """Drop a ``config.json`` into the throwaway working directory."""
    target = working_dir / "config.json"
    target.write_text(json.dumps(payload), encoding="utf-8")
    return target


@pytest.fixture(name="working_dir")
def _working_dir(tmp_path: Path) -> Path:
    """A per-case isolated working directory (never the shared sandbox)."""
    target = tmp_path / "working"
    target.mkdir()
    return target


@pytest.fixture(name="home_dir")
def _home_dir(tmp_path: Path) -> Path:
    """A per-case ``HOME``, so nothing touches the real ``~/.qwenpaw``."""
    target = tmp_path / "home"
    target.mkdir()
    return target


@pytest.mark.integration
@pytest.mark.p1
def test_doctor_prints_full_report_for_empty_working_dir(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """A bare working directory still yields every report section."""
    proc = _doctor(working_dir, home_dir)

    # No model is configured in a throwaway directory, so the command is
    # expected to report failures — but it must run to completion first.
    assert proc.returncode != 0
    for section in _EXPECTED_SECTIONS:
        assert section in proc.stdout, f"missing {section}"
    # It ran against *our* directory, not whatever HOME points at.
    assert str(working_dir) in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_environment_section_reports_python_and_working_dir(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """The Environment section names the interpreter and working dir."""
    proc = _doctor(working_dir, home_dir)

    assert "=== Environment ===" in proc.stdout
    assert "python version:" in proc.stdout
    assert "qwenpaw version:" in proc.stdout
    assert f"working_dir: {working_dir}" in proc.stdout
    assert f"QWENPAW_WORKING_DIR (env): {working_dir}" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_config_section_says_no_file_when_absent(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """With no ``config.json`` the report says so instead of failing."""
    proc = _doctor(working_dir, home_dir)

    assert "OK — (no file) defaults" in proc.stdout
    assert "=== Config (unknown keys) ===" not in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_config_section_accepts_schema_valid_file(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """A schema-valid ``config.json`` is reported OK by path."""
    config = _write_config(working_dir, {"channels": {}, "agents": {}})

    proc = _doctor(working_dir, home_dir)

    assert f"OK — {config}" in proc.stdout
    assert "=== Skipped (root config invalid) ===" not in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_unknown_top_level_key_is_named_in_report(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """An off-schema root key is reported by name, not silently dropped."""
    _write_config(working_dir, {"totally_bogus_key_xyz": 1})

    proc = _doctor(working_dir, home_dir)

    assert "=== Config (unknown keys) ===" in proc.stdout
    assert "top-level key 'totally_bogus_key_xyz'" in proc.stdout
    assert "not on root Config model" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_unknown_agents_subkey_is_reported_with_prefix(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """An off-schema key under ``agents`` is reported with its dotted path."""
    _write_config(working_dir, {"agents": {"bogus_agent_key": {}}})

    proc = _doctor(working_dir, home_dir)

    assert "agents.'bogus_agent_key'" in proc.stdout
    assert "not on AgentsConfig model" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_both_unknown_key_kinds_are_reported_together(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """Root and ``agents`` findings land in the same section, both named."""
    _write_config(
        working_dir,
        {"root_bogus": 1, "agents": {"agent_bogus": {}}},
    )

    proc = _doctor(working_dir, home_dir)

    assert "top-level key 'root_bogus'" in proc.stdout
    assert "agents.'agent_bogus'" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_non_dict_agents_value_short_circuits_validation(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """A wrong-typed ``agents`` value skips dependent checks, not crash."""
    _write_config(working_dir, {"agents": [1, 2]})

    proc = _doctor(working_dir, home_dir)

    # Root validation fails first, so the unknown-key scan never runs and
    # the dependent sections are reported as skipped instead of evaluated.
    assert "=== Skipped (root config invalid) ===" in proc.stdout
    assert "=== Config (unknown keys) ===" not in proc.stdout
    assert "agents: Input should be a valid dictionary" in proc.stderr


@pytest.mark.integration
@pytest.mark.p1
def test_malformed_json_is_repaired_not_crash(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """A truncated ``config.json`` still produces a report."""
    (working_dir / "config.json").write_text(
        '{"broken": [unclosed',
        encoding="utf-8",
    )

    proc = _doctor(working_dir, home_dir)

    assert "had JSON syntax issues that were auto-repaired" in proc.stderr
    # The report is complete — the bad file did not abort the command.
    assert "=== Environment ===" in proc.stdout
    assert "=== API ===" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_startup_paths_reports_log_appendable(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """The log-writability probe reports an appendable ``qwenpaw.log``."""
    proc = _doctor(working_dir, home_dir)

    assert "=== Startup paths ===" in proc.stdout
    assert "OK — qwenpaw.log appendable" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_startup_paths_reports_workspace_writable(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """The disk/startup probe counts writable workspace directories."""
    proc = _doctor(working_dir, home_dir)

    assert "workspace dir(s) writable" in proc.stdout
    assert "OK — 1 workspace dir(s) writable" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_provider_section_clean_without_custom_providers(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """With no custom providers the section reports no warnings."""
    proc = _doctor(working_dir, home_dir)

    assert "=== Providers (custom) ===" in proc.stdout
    assert "OK — no custom provider configuration warnings" in proc.stdout


@pytest.mark.integration
@pytest.mark.p1
def test_api_section_targets_pinned_port_not_default(
    working_dir: Path,
    home_dir: Path,
) -> None:
    """The API probe hits the pinned port, never the 8088 default."""
    port = _free_port()
    proc = run_cli(
        "--host",
        "127.0.0.1",
        "--port",
        str(port),
        "doctor",
        timeout=_CLI_TIMEOUT,
        home=home_dir,
        extra_env={
            "QWENPAW_WORKING_DIR": str(working_dir),
            "QWENPAW_SECRET_DIR": str(home_dir / "secret"),
            "QWENPAW_AUTH_ENABLED": "false",
            "QWENPAW_RUNNING_IN_CONTAINER": "true",
            "PYTHONIOENCODING": "utf-8",
            "NO_PROXY": "*",
        },
    )

    # Nothing is listening on the pinned port, so the probe must report it
    # unreachable — naming *our* port proves the global option was honoured.
    # Section headers go to stdout, FAIL lines to stderr (see the case
    # below), so the probe URL is asserted on stderr.
    assert "=== API ===" in proc.stdout
    assert f"http://127.0.0.1:{port}/api/healthz" in proc.stderr
    assert "FAIL — health not reachable" in proc.stderr
    # Guards the implicit dependency this file exists to avoid: a run that
    # silently fell back to the team service port would pass everywhere
    # locally and differ in CI.
    assert "8088" not in proc.stdout
    assert "8088" not in proc.stderr
