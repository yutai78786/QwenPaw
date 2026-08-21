# -*- coding: utf-8 -*-
"""LLM call metrics at ``RetryChatModel.__call__`` (v2.0 §2.1).

Every *logical* LLM call — one ``RetryChatModel.__call__`` invocation,
including its transparent retries — produces exactly one
``qwenpaw_llm_calls_total`` sample:

- ``status="success"`` when the call completes: a non-streaming
  response was returned, or the stream was consumed to its end;
- ``status="error"`` for every other terminal outcome — retries
  exhausted (4xx/5xx/429/acquire timeout/stream idle timeout) as well
  as cancellation or consumer abandonment mid-stream. The §2.2 enum
  is a closed two-value set; failure causes are not distinguished
  here (unknown values would collapse to ``_other``, but this module
  only ever emits the two canonical values).

Intermediate retry attempts are deliberately *not* counted: the retry
policy is an implementation detail of the call, and dashboards derive
the call success rate from the logical-call denominator.

Tokens come from ``ChatResponse.usage`` (agentscope ``ChatUsage``):

- ``type="prompt"``     := ``usage.input_tokens``
- ``type="completion"`` := ``usage.output_tokens``

These are exactly the source fields the tracing extractor reports as
``gen_ai.usage.input_tokens`` / ``gen_ai.usage.output_tokens``
(:mod:`qwenpaw.observability.tracing.extractor`), so metric counters
and trace attributes share one calibre. Cache detail
(``usage.cache_input_tokens`` / ``usage.cache_creation_input_tokens``,
the ``QPQAT_CACHE_*`` trace attributes) is *not* merged into the
prompt counter: the token-type label is a closed two-value set
(§2.3 cardinality budget), and the cache breakdown stays in trace
attributes. Provider semantics are already consistent upstream —
OpenAI-compatible and DashScope providers report ``input_tokens``
including cache reads, Anthropic reports the non-cache portion with
cache counts separately — and in both cases the metric value equals
the trace value for the same call.

Duration covers the whole logical call (retry waits included) — the
latency the caller actually experiences. Both statuses contribute to
``qwenpaw_llm_call_duration_seconds`` (it carries no status label).

Labels are allowlisted: ``model_family`` always flows through
:func:`qwenpaw.observability.metrics.allowlist.map_model_family`; a
raw model name never becomes a label value.
"""
from __future__ import annotations

import time
from typing import Any, AsyncGenerator, Optional

from .allowlist import LLM_STATUS_VALUES, LLM_TOKEN_TYPE_VALUES
from .registry import (
    LLM_CALLS_TOTAL,
    LLM_CALL_DURATION_SECONDS,
    LLM_TOKENS_TOTAL,
)

#: Canonical status values (closed set, §2.2 / §2.3).
STATUS_SUCCESS = "success"
STATUS_ERROR = "error"

#: Canonical token-type values (closed set, §2.3).
TOKEN_TYPE_PROMPT = "prompt"
TOKEN_TYPE_COMPLETION = "completion"

# Fail loudly if the allowlist ever drifts away from these constants:
# the series space is pre-initialised from the same tuples (registry),
# so a mismatch would silently drop samples.
assert (STATUS_SUCCESS, STATUS_ERROR) == LLM_STATUS_VALUES
assert (TOKEN_TYPE_PROMPT, TOKEN_TYPE_COMPLETION) == LLM_TOKEN_TYPE_VALUES


def _record_tokens(model_family: str, usage: Any) -> None:
    """Add token counts from a ``ChatUsage``-shaped object.

    ``prompt`` := ``input_tokens``, ``completion`` := ``output_tokens``
    (same source fields as the tracing extractor). Zero or missing
    values are skipped; cache breakdown is intentionally not merged
    (see module docstring).
    """
    prompt_tokens = getattr(usage, "input_tokens", None)
    completion_tokens = getattr(usage, "output_tokens", None)
    if prompt_tokens:
        LLM_TOKENS_TOTAL.labels(model_family, TOKEN_TYPE_PROMPT).inc(
            float(prompt_tokens),
        )
    if completion_tokens:
        LLM_TOKENS_TOTAL.labels(model_family, TOKEN_TYPE_COMPLETION).inc(
            float(completion_tokens),
        )


def record_llm_call(
    model_family: str,
    status: str,
    duration_seconds: float,
    usage: Optional[Any] = None,
) -> None:
    """Record one logical LLM call (callers invoke exactly once).

    Args:
        model_family: Already allowlist-mapped family label.
        status: One of :data:`LLM_STATUS_VALUES`.
        duration_seconds: Wall-clock duration of the whole logical
            call (retries included).
        usage: ``ChatUsage`` of the final response (stream: last chunk
            carrying usage). Tokens are only counted on success.
    """
    if status not in LLM_STATUS_VALUES:
        raise ValueError(
            f"status must be one of {LLM_STATUS_VALUES}, got {status!r}",
        )
    LLM_CALLS_TOTAL.labels(model_family, status).inc()
    LLM_CALL_DURATION_SECONDS.labels(model_family).observe(
        max(0.0, duration_seconds),
    )
    if status == STATUS_SUCCESS and usage is not None:
        _record_tokens(model_family, usage)


async def observe_llm_stream(
    model_family: str,
    stream: AsyncGenerator[Any, None],
    started_at: float,
) -> AsyncGenerator[Any, None]:
    """Yield *stream* unchanged; record the call exactly once at end.

    Success is recorded when the stream is consumed to completion
    (tokens from the last chunk carrying usage); any other termination
    — provider exception, cancellation, consumer ``aclose()`` — is an
    error. Chunks pass through unmodified.

    Args:
        model_family: Already allowlist-mapped family label.
        stream: The model's response stream.
        started_at: ``time.perf_counter()`` taken at the start of the
            logical call (before any retry), so the histogram covers
            the latency the caller experiences.
    """
    last_usage: Optional[Any] = None
    failed = False
    try:
        async for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                last_usage = usage
            yield chunk
    except BaseException:
        failed = True
        record_llm_call(
            model_family,
            STATUS_ERROR,
            time.perf_counter() - started_at,
        )
        raise
    finally:
        if not failed:
            record_llm_call(
                model_family,
                STATUS_SUCCESS,
                time.perf_counter() - started_at,
                last_usage,
            )
        await stream.aclose()
