# -*- coding: utf-8 -*-
# pylint: disable=protected-access
"""Regression guard: the suite must never touch the real user data dir.

``WORKING_DIR`` reaches disk through three different mechanisms and only one
of them can be redirected by a fixture, so this file asserts all three
resolve inside the temporary root that the repository-root ``conftest.py``
created *before* the package was imported.

Without that ordering guarantee a developer who exports
``QWENPAW_WORKING_DIR`` (container image, systemd unit, shell profile) gets
their live installation overwritten by a test run -- measured at 276 files
/ 4.2 MB for a single ``pytest tests/unit``, including a rewritten
``config.json`` that drops every configured channel credential.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from qwenpaw import constant
from qwenpaw.app.channels.matrix import channel as matrix_channel
from qwenpaw.app.channels.mattermost import channel as mattermost_channel
from qwenpaw.app.channels.qq import channel as qq_channel
from qwenpaw.app.channels.telegram import channel as telegram_channel
from qwenpaw.app.channels.wechat import channel as wechat_channel
from qwenpaw.config.utils import get_config_path
from qwenpaw.security.skill_scanner import _get_blocked_history_path

pytestmark = pytest.mark.unit

_ISOLATION_DISABLED = os.environ.get("QWENPAW_TEST_ISOLATION_DISABLED") == "1"

requires_isolation = pytest.mark.skipif(
    _ISOLATION_DISABLED,
    reason=(
        "QWENPAW_TEST_ISOLATION_DISABLED=1: the caller deliberately pointed "
        "the suite at a real directory"
    ),
)


def _isolated_root() -> Path:
    """Return the temporary root conftest.py created at import time."""
    resolved = Path(os.environ["QWENPAW_WORKING_DIR"]).resolve()
    assert resolved.name == "working_dir", (
        "expected the root conftest.py layout <root>/working_dir, got "
        f"{resolved}"
    )
    return resolved.parent


@requires_isolation
def test_working_dir_is_not_the_real_installation() -> None:
    """WORKING_DIR must live under the temporary root, not under $HOME.

    This is the assertion that fails if the repository-root ``conftest.py`` is
    removed or stops running before the package import: the module-level
    fallback in ``constant.py`` would then resolve to ``~/.copaw`` (legacy
    install) or ``~/.qwenpaw`` (default install), i.e. the developer's real
    data.
    """
    home = Path.home().resolve()
    working_dir = constant.WORKING_DIR.resolve()
    assert not working_dir.is_relative_to(home), (
        f"WORKING_DIR={working_dir} is inside $HOME={home}: the suite would "
        "read and write the developer's real installation"
    )
    assert working_dir.is_relative_to(_isolated_root())


@requires_isolation
def test_secret_and_backup_dirs_are_isolated() -> None:
    """SECRET_DIR and BACKUP_DIR are resolved at import time too.

    ``qwenpaw/__init__.py`` calls ``load_envs_into_environ()`` on import,
    which runs ``cleanup_stale_restore_artifacts(SECRET_DIR)`` -- a function
    that renames and removes directories. Isolating only ``WORKING_DIR``
    would still leave it pointed at the real secret store.
    """
    root = _isolated_root()
    assert constant.SECRET_DIR.resolve() == (root / "secret_dir").resolve()
    assert constant.BACKUP_DIR.resolve() == (root / "backup_dir").resolve()


@requires_isolation
def test_per_call_config_path_is_isolated() -> None:
    """Mechanism 1: ``get_config_path()`` looks WORKING_DIR up per call."""
    assert get_config_path().resolve().parent == _isolated_root() / "working_dir"


@requires_isolation
def test_module_level_working_dir_bindings_are_isolated() -> None:
    """Mechanism 2: channels that ``from ..constant import WORKING_DIR``.

    Patching ``qwenpaw.constant.WORKING_DIR`` does not reach these modules --
    the ``from`` import bound a separate name at their import time. Only
    setting the environment variable before *their* import works.
    """
    isolated = _isolated_root() / "working_dir"
    # Both are @staticmethod on MatrixChannel; they read the name bound by
    # `from ....constant import WORKING_DIR` at matrix/channel.py:75.
    assert (
        matrix_channel.MatrixChannel._auth_state_path().resolve().parent
        == isolated
    )
    assert (
        matrix_channel.MatrixChannel._sync_token_path().resolve().parent
        == isolated
    )
    # skill_scanner imports WORKING_DIR *inside* the function, so it re-reads
    # qwenpaw.constant on every call -- the other shape of the same defect.
    assert _get_blocked_history_path().resolve().parent == isolated


@requires_isolation
def test_import_time_constants_are_isolated() -> None:
    """Mechanism 3: module-level constants evaluated at import time.

    No ``monkeypatch`` can undo these -- the ``Path`` was already built when
    the module was imported. They are the reason this has to be an
    environment-level fix rather than a fixture.
    """
    isolated = _isolated_root() / "working_dir"
    assert qq_channel._DEFAULT_MEDIA_DIR.resolve().parent.parent == isolated
    assert (
        mattermost_channel._DEFAULT_MEDIA_DIR.resolve().parent.parent
        == isolated
    )
    assert (
        telegram_channel._DEFAULT_MEDIA_DIR.resolve().parent.parent == isolated
    )
    assert wechat_channel._DEFAULT_TOKEN_FILE.resolve().parent == isolated


@requires_isolation
def test_root_conftest_ran_before_the_package_import() -> None:
    """The temporary root must already exist by the time tests are collected.

    Guards the *ordering*, which is the whole point: the root ``conftest.py``
    has to be imported before ``tests/conftest.py`` line 24 imports the
    package, otherwise every constant above is frozen against the real
    installation and nothing in this file can catch it.
    """
    root = _isolated_root()
    assert root.is_dir(), f"{root} was created at conftest import time"
    assert root.name.startswith("qwenpaw-tests-")
