# -*- coding: utf-8 -*-
"""Typed cancellation reasons for run lifecycle cancellation.

QwenPaw cancels in-flight runs from distinct sources: the console
background-task timeout guard (:mod:`qwenpaw.app.routers.console`) and
user-initiated stops (``TaskTracker.request_stop``). Both ultimately
raise ``asyncio.CancelledError`` inside
:meth:`qwenpaw.app.workspace.Workspace.stream_query`, so observers cannot
tell *why* a run was cancelled from the exception alone.

This module attaches a typed reason to ``CancelledError`` at the cancel
site (via ``Task.cancel(msg=...)``) and provides the extraction helpers
that run observers (e.g. metrics) use to map cancellations to outcome
values such as ``timeout`` and ``cancelled``.

The ``msg`` payload survives through arbitrarily nested ``async for``
chains: the same ``CancelledError`` instance is raised at the innermost
suspension point and propagates outward. This is verified by
``tests/unit/utils/test_cancellation.py``.
"""
from __future__ import annotations

import asyncio
from typing import Optional

#: Reason attached when the console background-task timeout guard cancels.
CANCEL_REASON_TIMEOUT = "timeout"

#: Reason attached when a user-initiated stop cancels a run
#: (POST /console/chat/stop, the /stop chat command).
CANCEL_REASON_USER_STOP = "user_stop"

#: Namespace prefix for cancellation messages. Plain ``CancelledError``
#: messages carry no prefix; observers key on this to separate typed
#: QwenPaw cancellations from unrelated ones.
CANCEL_MSG_PREFIX = "qwenpaw.cancellation:"


def cancellation_msg(reason: str) -> str:
    """Build the ``Task.cancel(msg=...)`` payload for *reason*."""
    return f"{CANCEL_MSG_PREFIX}{reason}"


def cancel_with_reason(
    task: "asyncio.Task[object]",
    reason: str,
) -> bool:
    """Cancel *task* carrying typed *reason* on the resulting error.

    Thin wrapper over ``Task.cancel(msg=...)``; returns ``False`` when the
    task already finished, matching stdlib semantics.
    """
    return task.cancel(msg=cancellation_msg(reason))


def extract_cancellation_reason(exc: BaseException) -> Optional[str]:
    """Return the typed reason if *exc* is a typed QwenPaw cancellation.

    Returns ``None`` for non-``CancelledError`` exceptions, plain (untagged)
    cancellations, and cancellations whose message does not use the
    QwenPaw namespace.
    """
    if not isinstance(exc, asyncio.CancelledError) or not exc.args:
        return None
    message = exc.args[0]
    if not isinstance(message, str):
        return None
    if message.startswith(CANCEL_MSG_PREFIX):
        return message[len(CANCEL_MSG_PREFIX) :]
    return None


def is_qwenpaw_cancellation(exc: BaseException) -> bool:
    """True if *exc* carries a typed QwenPaw cancellation reason."""
    return extract_cancellation_reason(exc) is not None
