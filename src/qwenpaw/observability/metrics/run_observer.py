# -*- coding: utf-8 -*-
"""Run lifecycle observer at ``Workspace.stream_query`` (v2.0 §3).

``Workspace.stream_query`` is the single funnel for ACP, cron,
heartbeat, PawApp and Voice runs, so observing it covers every run.

Outcome is decided from two signals so both runtime semantics are
captured:

1. Terminal ``response`` event status — Harness runtimes swallow
   exceptions and emit a ``failed``/``cancelled`` response envelope.
2. ``BaseException`` (including ``CancelledError``/``GeneratorExit``) —
   the native Runtime re-raises after emitting its terminal envelope.

The typed cancellation reason from
:mod:`qwenpaw.utils.cancellation` distinguishes ``timeout`` from
``user_stop`` (recorded as ``cancelled``).

Exactly one ``qwenpaw_runs_total`` sample is emitted per run, in the
``finally`` block; the active gauge is incremented/decremented around
the stream.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncGenerator, Optional

from qwenpaw.schemas import RunStatus
from qwenpaw.utils.cancellation import (
    CANCEL_REASON_TIMEOUT,
    extract_cancellation_reason,
)

from .allowlist import validate_outcome
from .registry import (
    RUNS_ACTIVE,
    RUNS_TOTAL,
    RUN_DURATION_SECONDS,
    RUN_TTFT_SECONDS,
)

#: Response statuses that terminate a run.
_TERMINAL_STATUSES = frozenset(
    {
        RunStatus.Completed,
        RunStatus.Failed,
        RunStatus.Cancelled,
    },
)


def _response_status(item: Any) -> Optional[RunStatus]:
    """Return the terminal ``RunStatus`` if *item* is a response event."""
    if getattr(item, "object", None) != "response":
        return None
    status = getattr(item, "status", None)
    if status in _TERMINAL_STATUSES:
        return status
    if isinstance(status, str):
        try:
            parsed = RunStatus(status)
        except ValueError:
            return None
        return parsed if parsed in _TERMINAL_STATUSES else None
    return None


def _is_content_delta(item: Any) -> bool:
    """True when *item* is a non-empty streaming content delta (TTFT)."""
    if getattr(item, "object", None) != "content":
        return False
    if not getattr(item, "delta", False):
        return False
    text = getattr(item, "text", None)
    if isinstance(text, str):
        return bool(text.strip())
    # Non-text modalities: a delta chunk carries content by definition.
    return True


def _outcome_from_exception(exc: BaseException) -> str:
    """Map a raised exception to a run outcome."""
    reason = extract_cancellation_reason(exc)
    if reason == CANCEL_REASON_TIMEOUT:
        return validate_outcome("timeout")
    if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
        return validate_outcome("cancelled")
    return validate_outcome("error")


def _outcome_from_final_status(
    final_status: Optional[RunStatus],
) -> str:
    """Map the terminal response status to a run outcome.

    A run that ends without a ``completed`` envelope has no success
    evidence, so it is counted as ``error``.
    """
    if final_status == RunStatus.Completed:
        return validate_outcome("success")
    if final_status == RunStatus.Cancelled:
        return validate_outcome("cancelled")
    return validate_outcome("error")


async def observe_stream_query(
    channel_label: str,
    inner: AsyncGenerator[Any, None],
) -> AsyncGenerator[Any, None]:
    """Yield *inner* unchanged while recording run lifecycle metrics.

    All events pass through untouched; metrics are recorded exactly
    once in ``finally`` regardless of how the stream ends.
    """
    started_at = time.perf_counter()
    ttft_at: Optional[float] = None
    final_status: Optional[RunStatus] = None
    outcome: Optional[str] = None

    RUNS_ACTIVE.inc()
    try:
        async for item in inner:
            if ttft_at is None and _is_content_delta(item):
                ttft_at = time.perf_counter()
            status = _response_status(item)
            if status is not None:
                final_status = status
            yield item
    except BaseException as exc:
        outcome = _outcome_from_exception(exc)
        raise
    finally:
        RUNS_ACTIVE.dec()
        if outcome is None:
            outcome = _outcome_from_final_status(final_status)
        RUNS_TOTAL.labels(outcome=outcome, channel=channel_label).inc()
        RUN_DURATION_SECONDS.labels(channel=channel_label).observe(
            time.perf_counter() - started_at,
        )
        if ttft_at is not None:
            RUN_TTFT_SECONDS.labels(channel=channel_label).observe(
                ttft_at - started_at,
            )
