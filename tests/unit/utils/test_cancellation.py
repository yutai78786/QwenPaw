# -*- coding: utf-8 -*-
"""Unit tests for ``qwenpaw.utils.cancellation``.

Covers:
- cancel_with_reason attaches the typed reason to CancelledError
- reason survives nested ``async for`` chains (producer -> stream_one
  -> stream_query), so Workspace-level observers can read it
- extract_cancellation_reason returns None for untyped / foreign cancels
"""
# pylint: disable=redefined-outer-name
from __future__ import annotations

import asyncio

import pytest

from qwenpaw.utils.cancellation import (
    CANCEL_MSG_PREFIX,
    CANCEL_REASON_TIMEOUT,
    CANCEL_REASON_USER_STOP,
    cancel_with_reason,
    cancellation_msg,
    extract_cancellation_reason,
    is_qwenpaw_cancellation,
)


def test_cancellation_msg_uses_namespace_prefix():
    assert cancellation_msg("timeout") == f"{CANCEL_MSG_PREFIX}timeout"
    assert (
        cancellation_msg(CANCEL_REASON_USER_STOP)
        == f"{CANCEL_MSG_PREFIX}user_stop"
    )


async def test_cancel_with_reason_attaches_reason():
    started = asyncio.Event()

    async def sleeper():
        started.set()
        await asyncio.sleep(60)

    task = asyncio.create_task(sleeper())
    await started.wait()

    assert cancel_with_reason(task, CANCEL_REASON_TIMEOUT) is True
    with pytest.raises(asyncio.CancelledError) as exc_info:
        await task

    assert extract_cancellation_reason(exc_info.value) == "timeout"
    assert is_qwenpaw_cancellation(exc_info.value)


async def test_cancel_with_reason_returns_false_for_done_task():
    async def noop():
        return None

    task = asyncio.create_task(noop())
    await task

    assert cancel_with_reason(task, CANCEL_REASON_TIMEOUT) is False


async def test_reason_survives_nested_async_for_chains():
    """The production cancel path: outer task -> stream_one -> stream_query.

    ``Task.cancel(msg=...)`` must surface the same typed reason at the
    innermost generator so a Workspace observer sees it.
    """
    observed: dict = {}

    async def inner_stream():
        await asyncio.sleep(60)
        yield "never"

    async def stream_query_sim():
        try:
            async for item in inner_stream():
                yield item
        except asyncio.CancelledError as exc:
            observed["reason"] = extract_cancellation_reason(exc)
            raise
        finally:
            observed["finally_ran"] = True

    async def stream_one_sim():
        async for item in stream_query_sim():
            yield item

    async def producer():
        async for _ in stream_one_sim():
            pass

    task = asyncio.create_task(producer())
    await asyncio.sleep(0.05)
    cancel_with_reason(task, CANCEL_REASON_USER_STOP)
    with pytest.raises(asyncio.CancelledError):
        await task

    assert observed == {
        "reason": CANCEL_REASON_USER_STOP,
        "finally_ran": True,
    }


@pytest.mark.parametrize(
    "exc",
    [
        asyncio.CancelledError(),  # untyped cancel
        asyncio.CancelledError("client disconnected"),  # foreign message
        asyncio.CancelledError(42),  # non-string message
        RuntimeError("boom"),  # not a cancellation at all
    ],
)
def test_extract_reason_rejects_untyped_and_foreign(exc):
    assert extract_cancellation_reason(exc) is None
    assert is_qwenpaw_cancellation(exc) is False


def test_extract_reason_accepts_both_defined_reasons():
    for reason in (CANCEL_REASON_TIMEOUT, CANCEL_REASON_USER_STOP):
        exc = asyncio.CancelledError(cancellation_msg(reason))
        assert extract_cancellation_reason(exc) == reason
