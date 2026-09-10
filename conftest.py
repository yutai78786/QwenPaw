# -*- coding: utf-8 -*-
"""Root pytest configuration: isolate every test from the real user data dir.

Running ``pytest`` from the repository root must never read or write the
developer's live QwenPaw installation. Before this file existed it did:
``qwenpaw.constant`` resolves ``WORKING_DIR`` **at import time** from
``QWENPAW_WORKING_DIR``, and ``tests/conftest.py`` imports the package at
module level, so by the time any fixture ran, every path derived from
``WORKING_DIR`` was already frozen. A developer whose environment exports
``QWENPAW_WORKING_DIR`` (a container image, a systemd unit, a shell profile)
would find that environment silently overwritten by a test run.

Measured on a host exporting ``QWENPAW_WORKING_DIR`` at a populated install,
a single ``pytest tests/unit`` run wrote 276 files (4.2 MB) into that
directory:

* ``config.json`` -- rewritten from the test's own in-memory config, which
  drops every channel credential the user had configured.
* ``dingtalk_session_webhooks.json``, ``dingtalk-active-cards.json``,
  ``feishu_receive_ids.json``, ``matrix_auth_state.json``,
  ``wechat_context_tokens.json``, ``skill_scanner_blocked.json``
* ``skill_pool/`` (a full copy of the bundled skills), ``workspaces/``,
  ``media/``, ``local_models/``, ``.telemetry_collected``

Why a fixture cannot fix this
------------------------------
``WORKING_DIR`` is consumed three different ways, and only the first can be
reached from a fixture:

1. ``get_config_path().parent`` -- looked up per call, so patching
   ``qwenpaw.config.utils.WORKING_DIR`` works (DingTalk cards/webhooks,
   Feishu receive ids).
2. Module-level ``WORKING_DIR`` imported into a channel module -- patching
   the *definition* module does nothing because ``from ..constant import
   WORKING_DIR`` binds a separate name (Matrix, skill_scanner).
3. Module-level constants evaluated at import time -- e.g.
   ``_DEFAULT_MEDIA_DIR = WORKING_DIR / "media" / "qq"`` (QQ, Mattermost,
   Telegram) and ``_DEFAULT_TOKEN_FILE`` (WeChat). No ``monkeypatch`` can
   undo a value that was already computed.

The only reliable point is *before the package is imported*, which means
setting the environment variables at conftest module level.

Why this file lives at the repository root
------------------------------------------
pytest imports conftest.py files from the rootdir downwards, so a root-level
conftest is imported before ``tests/conftest.py`` -- and therefore before the
package import on its line 24. ``tests/integration/browser/conftest.py``
already uses exactly this technique for its own subtree; this extends it to
the whole suite.

Suites that deliberately run against a directory of their own choosing are
unaffected because they do not share this rootdir: ``e2e/`` and
``plugins/apps/qwenpaw-creator/backend`` each ship their own ``pytest.ini``
and are invoked with their own working directory, and ``tests/integration/``
spawns the backend as a subprocess with an explicit ``env``.

Set ``QWENPAW_TEST_ISOLATION_DISABLED=1`` to keep whatever the caller
exported -- use it to reproduce a bug against a seeded install.
"""

import os
import shutil
import tempfile
from pathlib import Path

import pytest

# All three are resolved at import time from the environment and all three
# default to paths derived from the real installation.
_ISOLATION_ENV_VARS = (
    "QWENPAW_WORKING_DIR",
    "QWENPAW_SECRET_DIR",
    "QWENPAW_BACKUP_DIR",
)

_TEST_ROOT: Path | None = None

if os.environ.get("QWENPAW_TEST_ISOLATION_DISABLED") != "1":
    _TEST_ROOT = Path(tempfile.mkdtemp(prefix="qwenpaw-tests-"))
    for _var in _ISOLATION_ENV_VARS:
        # Assign unconditionally: inheriting a developer's live directory is
        # exactly the defect being fixed, so an existing value must not win.
        _target = _TEST_ROOT / _var.lower().removeprefix("qwenpaw_")
        _target.mkdir(parents=True, exist_ok=True)
        os.environ[_var] = str(_target)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Remove the temporary tree created at import time."""
    del session, exitstatus
    if _TEST_ROOT is not None:
        shutil.rmtree(_TEST_ROOT, ignore_errors=True)
