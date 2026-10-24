# -*- coding: utf-8 -*-
# pylint: disable=protected-access
"""Shared plugin test isolation."""

import pytest

from qwenpaw.plugins.registry import PluginRegistry


@pytest.fixture(name="short_interrupt_timeout")
def bounded_interrupt_timeout(monkeypatch):
    """Exercise blocked lifecycle retries without the production 5s wait.

    The budget still has to cover several cross-thread storage operations
    per retry, each of which is a full ``run_sync_io`` round trip.  A 0.2s
    budget left only a few milliseconds of slack on the Windows runner and
    intermittently surfaced as ``PluginBusyError`` from ``mutation()``.
    2.0s keeps the retry path exercised while staying well below the
    production 5s constant.
    """
    from qwenpaw.plugins import activity

    monkeypatch.setattr(activity, "INTERRUPT_TIMEOUT_SECONDS", 2.0)
    return activity.INTERRUPT_TIMEOUT_SECONDS


@pytest.fixture()
def short_stream_stop_timeout(monkeypatch, short_interrupt_timeout):
    """Scale nested stream stops with the outer interruption budget."""
    from qwenpaw.plugins import custody

    monkeypatch.setattr(custody, "TASK_STOP_SECONDS", short_interrupt_timeout)


@pytest.fixture()
def fresh_registry():
    """Reset the singleton and restore it even if a test fails."""
    old = PluginRegistry._instance
    PluginRegistry._instance = None
    try:
        yield PluginRegistry()
    finally:
        PluginRegistry._instance = old
