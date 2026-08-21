# -*- coding: utf-8 -*-
"""Tests: LLM call metrics at RetryChatModel (v2.0 §2.1).

Covers:
- exactly one logical-call sample per __call__ (retries transparent)
- status enum: success (response returned / stream consumed) vs error
  (final failure, mid-stream failure, consumer abandonment, cancel)
- tokens from ChatResponse.usage: prompt := input_tokens (cache
  included upstream, never double-added), completion := output_tokens
- model_family allowlist: raw model name never reaches a label
- duration histogram covers the whole logical call (both statuses)
- switch off (QPQAT_METRICS_ENABLED default false): zero behaviour
  change, zero metric movement
"""
# pylint: disable=protected-access,redefined-outer-name,unused-argument
from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator

import pytest
from agentscope.model._model_response import ChatResponse
from agentscope.model._model_usage import ChatUsage
from prometheus_client import generate_latest

from qwenpaw.observability.metrics.llm_observer import (
    record_llm_call,
)
from qwenpaw.observability.metrics.registry import REGISTRY
from qwenpaw.providers.rate_limiter import _limiters
from qwenpaw.providers.retry_chat_model import (
    RateLimitConfig,
    RetryChatModel,
    RetryConfig,
)

METRICS_ENV = "QPQAT_METRICS_ENABLED"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _sample_value(text: str, needle: str) -> float:
    """Extract the value of the exposition line containing *needle*."""
    for line in text.splitlines():
        if needle in line and not line.startswith("#"):
            return float(line.rsplit(" ", 1)[-1])
    return 0.0


def _exposition() -> str:
    return generate_latest(REGISTRY).decode()


def _response(
    input_tokens: int = 0,
    output_tokens: int = 0,
) -> ChatResponse:
    usage = None
    if input_tokens or output_tokens:
        usage = ChatUsage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            time=0.01,
        )
    return ChatResponse(content=[], is_last=True, usage=usage)


class _FakeModel:
    """Minimal inner model (mirrors test_retry_chat_model.py style)."""

    model = "qwen3-max"
    stream = True
    context_size = 32768
    parameters = None

    def __init__(self, result: Any) -> None:
        self.result = result
        self.calls = 0

    async def __call__(
        self,
        *_args: Any,
        **_kwargs: Any,
    ) -> Any:
        self.calls += 1
        result = self.result
        if isinstance(result, Exception):
            raise result
        return result


class _FailThenSucceedModel(_FakeModel):
    """Fails the first attempt with a retryable error, then succeeds."""

    async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
        self.calls += 1
        if self.calls == 1:
            exc = Exception("temporary failure")
            exc.status_code = 503  # type: ignore[attr-defined]
            raise exc
        return self.result


def _make_retry(
    inner: Any,
    retries: int = 0,
) -> RetryChatModel:
    return RetryChatModel(
        inner,  # type: ignore[arg-type]
        retry_config=RetryConfig(
            enabled=retries > 0,
            max_retries=max(retries, 1),
            backoff_base=0.01,
            backoff_cap=0.01,
        ),
        rate_limit_config=RateLimitConfig(
            max_concurrent=1,
            max_qpm=0,
            pause_seconds=1.0,
            jitter_range=0.0,
            acquire_timeout=10.0,
        ),
    )


@pytest.fixture(autouse=True)
def _isolate_limiters():
    _limiters.clear()
    yield
    _limiters.clear()


@pytest.fixture
def metrics_on(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv(METRICS_ENV, "true")


# ---------------------------------------------------------------------------
# non-streaming
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_streaming_success_records_tokens(metrics_on):
    inner = _FakeModel(_response(input_tokens=100, output_tokens=30))
    model = _make_retry(inner)
    before = _exposition()

    result = await model()

    assert isinstance(result, ChatResponse)
    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        == 1.0
    )
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        == 100.0
    )
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_tokens_total{model_family="qwen",'
            'type="completion"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_tokens_total{model_family="qwen",'
            'type="completion"}',
        )
        == 30.0
    )
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_call_duration_seconds_count{model_family="qwen"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_call_duration_seconds_count{model_family="qwen"}',
        )
        == 1.0
    )


@pytest.mark.asyncio
async def test_non_streaming_failure_records_error_no_tokens(metrics_on):
    exc = Exception("invalid request")
    exc.status_code = 400  # type: ignore[attr-defined]
    inner = _FakeModel(exc)
    model = _make_retry(inner)
    before = _exposition()

    with pytest.raises(Exception, match="invalid request"):
        await model()

    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        == 1.0
    )
    # success counter and tokens untouched
    assert _sample_value(
        after,
        'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
    ) == _sample_value(
        before,
        'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
    )
    assert _sample_value(
        after,
        'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
    ) == _sample_value(
        before,
        'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
    )


@pytest.mark.asyncio
async def test_retry_is_transparent_one_logical_call(metrics_on):
    inner = _FailThenSucceedModel(_response(input_tokens=5, output_tokens=7))
    model = _make_retry(inner, retries=2)
    before = _exposition()

    result = await model()

    assert inner.calls == 2
    assert isinstance(result, ChatResponse)
    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        == 1.0
    )
    # tokens come from the final response only
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        == 5.0
    )


# ---------------------------------------------------------------------------
# streaming
# ---------------------------------------------------------------------------


async def _usage_stream() -> AsyncGenerator[Any, None]:
    yield ChatResponse(content=[], is_last=False)
    yield _response(input_tokens=42, output_tokens=11)


async def _failing_stream() -> AsyncGenerator[Any, None]:
    yield ChatResponse(content=[], is_last=False)
    exc = Exception("upstream gone")
    exc.status_code = 500  # type: ignore[attr-defined]
    raise exc


class _StreamModel(_FakeModel):
    def __init__(self, stream_factory: Any) -> None:
        super().__init__(None)
        self.stream_factory = stream_factory

    async def __call__(self, *_args: Any, **_kwargs: Any) -> Any:
        self.calls += 1
        return self.stream_factory()


@pytest.mark.asyncio
async def test_stream_success_records_tokens_on_completion(metrics_on):
    inner = _StreamModel(_usage_stream)
    model = _make_retry(inner)
    before = _exposition()

    stream = await model()
    chunks = [chunk async for chunk in stream]

    assert len(chunks) == 2
    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="success"}',
        )
        == 1.0
    )
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        == 42.0
    )


@pytest.mark.asyncio
async def test_stream_mid_failure_records_error(metrics_on):
    inner = _StreamModel(_failing_stream)
    model = _make_retry(inner)
    before = _exposition()

    stream = await model()
    with pytest.raises(Exception, match="upstream gone"):
        async for _chunk in stream:
            pass

    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        == 1.0
    )


@pytest.mark.asyncio
async def test_stream_consumer_abandonment_records_error(metrics_on):
    async def _slow_stream() -> AsyncGenerator[Any, None]:
        yield ChatResponse(content=[], is_last=False)
        await asyncio.Event().wait()  # never completes on its own
        yield _response(input_tokens=1, output_tokens=1)

    inner = _StreamModel(_slow_stream)
    model = _make_retry(inner)
    before = _exposition()

    stream = await model()
    assert await stream.__anext__()  # consume the first chunk
    await stream.aclose()  # consumer abandons mid-stream

    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_calls_total{model_family="qwen",status="error"}',
        )
        == 1.0
    )


# ---------------------------------------------------------------------------
# allowlist / calibre contract
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unknown_model_family_collapses_to_other(metrics_on):
    class _ClaudeModel(_FakeModel):
        model = "claude-sonnet-4"

    inner = _ClaudeModel(_response(input_tokens=2, output_tokens=2))
    model = _make_retry(inner)

    await model()

    after = _exposition()
    # raw model name must never reach a label
    assert "claude" not in after
    assert _sample_value(
        after,
        'qwenpaw_llm_calls_total{model_family="other",status="success"}',
    )


@pytest.mark.asyncio
async def test_cache_tokens_not_double_counted(metrics_on):
    # Provider convention (agentscope): input_tokens already includes
    # cache reads; the observer must add exactly input_tokens.
    usage = ChatUsage(
        input_tokens=100,
        output_tokens=10,
        time=0.01,
        cache_input_tokens=40,
    )
    inner = _FakeModel(
        ChatResponse(content=[], is_last=True, usage=usage),
    )
    model = _make_retry(inner)
    before = _exposition()

    await model()

    after = _exposition()
    assert (
        _sample_value(
            after,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        - _sample_value(
            before,
            'qwenpaw_llm_tokens_total{model_family="qwen",type="prompt"}',
        )
        == 100.0  # NOT 140 — cache is a subset, never added on top
    )


@pytest.mark.asyncio
async def test_switch_off_zero_metric_movement():
    # default: QPQAT_METRICS_ENABLED unset/false
    inner = _FakeModel(_response(input_tokens=9, output_tokens=9))
    model = _make_retry(inner)
    before = _exposition()

    result = await model()

    assert isinstance(result, ChatResponse)
    assert _exposition() == before


def test_record_llm_call_rejects_unknown_status():
    with pytest.raises(ValueError, match="status"):
        record_llm_call("qwen", "successish", 0.0)
