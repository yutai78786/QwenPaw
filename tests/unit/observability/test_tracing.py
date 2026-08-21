# -*- coding: utf-8 -*-
"""Tests for ACS monitoring tracing (v2.0 §4).

Covers the continuation-order requirements:

- async generator streaming call span lifecycle (exactly-once end,
  response attributes from the last chunk);
- ``CancelledError`` capture (plain and typed reason via P-1);
- allowlist compliance — no sensitive fields (messages, tool
  arguments/results, exception text) ever enter a span;
- error spans stay sanitized (no ``record_exception``, no exception
  message in the status description);
- inbound trace-context extraction middleware;
- provider setup/shutdown behaviour (default off, endpoint fallback,
  idempotency).
"""
# pylint: disable=protected-access,redefined-outer-name,unused-argument
# pylint: disable=unused-variable
from __future__ import annotations

import asyncio
import inspect
from typing import Any

import pytest
from opentelemetry import trace as otel_trace
from opentelemetry.trace.propagation.tracecontext import (
    TraceContextTextMapPropagator,
)
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode

from agentscope.message import Msg, ToolCallBlock
from agentscope.model import ChatModelBase, ChatResponse, ChatUsage

from qwenpaw.observability.tracing import extractor, setup as tracing_setup
from qwenpaw.observability.tracing.config import (
    DEFAULT_OTLP_PROTOCOL,
    otlp_endpoint,
    otlp_protocol,
    tracing_enabled,
)
from qwenpaw.observability.tracing.http_middleware import HttpTracingMiddleware
from qwenpaw.observability.tracing.middleware import (
    MetadataOnlyTracingMiddleware,
    _wrap_streamed_model_call,
)
from qwenpaw.utils.cancellation import (
    CANCEL_REASON_TIMEOUT,
    cancellation_msg,
)


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def in_memory_tracing():
    """Install a real SDK provider exporting to memory; restore after."""
    provider = TracerProvider()
    exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    prev_provider = otel_trace._TRACER_PROVIDER
    prev_once = otel_trace._TRACER_PROVIDER_SET_ONCE
    otel_trace._TRACER_PROVIDER = provider
    yield provider, exporter
    otel_trace._TRACER_PROVIDER = prev_provider
    otel_trace._TRACER_PROVIDER_SET_ONCE = prev_once
    provider.shutdown()


class DashScopeChatModel(ChatModelBase):
    """Concrete model class for provider-mapping tests."""


@pytest.fixture
def model() -> ChatModelBase:
    """Minimal chat model instance (metadata only)."""
    instance = object.__new__(DashScopeChatModel)
    instance.model = "qwen3-max"
    return instance


def _usage(input_tokens: int = 12, output_tokens: int = 7) -> ChatUsage:
    return ChatUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        time=0.01,
    )


def _response(usage: ChatUsage | None = None) -> ChatResponse:
    return ChatResponse(content=[], is_last=True, usage=usage)


def _msg(name: str = "a", role: str = "assistant", text: str = "") -> Msg:
    """Msg carrying optional secret text — used to prove content never
    leaks into spans."""
    from agentscope.message import TextBlock

    content = [TextBlock(type="text", text=text)] if text else []
    return Msg(name=name, content=content, role=role)


def _tool_call(name: str = "search") -> ToolCallBlock:
    return ToolCallBlock(
        type="tool_call",
        id="call-1",
        name=name,
        input='{"query": "TOP SECRET argument"}',
    )


async def _drain(gen: Any) -> list:
    return [item async for item in gen]


# ---------------------------------------------------------------------------
# config (§4.4 / §4.3)
# ---------------------------------------------------------------------------


def test_tracing_disabled_by_default(monkeypatch):
    monkeypatch.delenv("QPQAT_TRACING_ENABLED", raising=False)
    assert tracing_enabled() is False
    monkeypatch.setenv("QPQAT_TRACING_ENABLED", "true")
    assert tracing_enabled() is True


def test_otlp_endpoint_config(monkeypatch):
    monkeypatch.delenv("QPQAT_OTLP_ENDPOINT", raising=False)
    assert otlp_endpoint() is None
    monkeypatch.setenv("QPQAT_OTLP_ENDPOINT", "collector-gateway:4317")
    assert otlp_endpoint() == "collector-gateway:4317"


def test_otlp_protocol_config(monkeypatch):
    monkeypatch.delenv("QPQAT_OTLP_PROTOCOL", raising=False)
    assert otlp_protocol() == DEFAULT_OTLP_PROTOCOL == "grpc"
    monkeypatch.setenv("QPQAT_OTLP_PROTOCOL", "http")
    assert otlp_protocol() == "http"
    monkeypatch.setenv("QPQAT_OTLP_PROTOCOL", "bogus")
    assert otlp_protocol() == DEFAULT_OTLP_PROTOCOL


# ---------------------------------------------------------------------------
# extractor (§4.1 metadata-only)
# ---------------------------------------------------------------------------


def test_chat_request_attributes_allowlisted(model):
    attrs = extractor.chat_request_attributes(model)
    assert attrs[extractor.GEN_AI_OPERATION_NAME] == "chat"
    assert attrs[extractor.GEN_AI_PROVIDER_NAME] == "dashscope"
    assert attrs[extractor.QPQAT_MODEL_FAMILY] == "qwen"
    assert set(attrs) <= extractor.ALLOWED_ATTRIBUTE_KEYS


def test_chat_response_attributes_tokens_only():
    attrs = extractor.chat_response_attributes(_response(_usage(12, 7)))
    assert attrs == {
        extractor.GEN_AI_USAGE_INPUT_TOKENS: 12,
        extractor.GEN_AI_USAGE_OUTPUT_TOKENS: 7,
    }
    # Emptiness asserts the token-count-absence contract.
    assert not extractor.chat_response_attributes(None)
    assert not extractor.chat_response_attributes(_response(None))


def test_tool_attributes_name_only():
    attrs = extractor.tool_request_attributes("search")
    assert attrs == {
        extractor.GEN_AI_OPERATION_NAME: "execute_tool",
        extractor.GEN_AI_TOOL_NAME: "search",
    }


def test_agent_attributes_operation_only():
    assert extractor.agent_request_attributes() == {
        extractor.GEN_AI_OPERATION_NAME: "invoke_agent",
    }


def test_span_names_never_carry_raw_identifiers(model):
    assert extractor.chat_span_name(model) == "chat qwen"
    assert extractor.agent_span_name() == "invoke_agent"
    assert extractor.tool_span_name("search") == "execute_tool search"
    # raw model name must not leak into the span name
    assert "qwen3-max" not in extractor.chat_span_name(model)


def test_error_type_bounded_values():
    assert extractor.error_type_of(ValueError("secret=abc")) == "ValueError"
    assert extractor.error_type_of(asyncio.CancelledError()) == "cancelled"
    typed = asyncio.CancelledError(cancellation_msg(CANCEL_REASON_TIMEOUT))
    assert extractor.error_type_of(typed) == CANCEL_REASON_TIMEOUT


def test_set_span_error_never_leaks(in_memory_tracing):
    provider, exporter = in_memory_tracing
    tracer = otel_trace.get_tracer("test")
    span = tracer.start_span("op")
    try:
        raise ValueError("api_key=sk-VERYSECRET")
    except ValueError as exc:
        extractor.set_span_error(span, exc)
    (recorded,) = exporter.get_finished_spans()
    assert recorded.status.status_code == StatusCode.ERROR
    # no exception message in the status description
    assert recorded.status.description is None
    # record_exception must NOT have been called (no exception event)
    assert recorded.events == ()
    attrs = dict(recorded.attributes)
    assert attrs[extractor.ERROR_TYPE] == "ValueError"
    assert attrs[extractor.QPQAT_ERROR_SUMMARY] == "ValueError"
    assert "sk-VERYSECRET" not in str(attrs.values())


# ---------------------------------------------------------------------------
# middleware: model-call lifecycle (§4.1 streaming + cancellation)
# ---------------------------------------------------------------------------


async def test_on_model_call_streaming_span_lifecycle(
    in_memory_tracing,
    model,
):
    """Async-generator streaming call: span ends exactly once in the
    generator's ``finally`` and picks usage from the last chunk."""
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        async def stream():
            yield _response(None)  # intermediate chunk, no usage
            yield _response(_usage(12, 7))  # last chunk carries usage

        return stream()

    result = await middleware.on_model_call(
        agent=object(),
        input_kwargs={"current_model": model},
        next_handler=next_handler,
    )
    assert inspect.isasyncgen(result)
    # span not ended before the stream is drained
    assert exporter.get_finished_spans() == ()
    chunks = await _drain(result)
    assert len(chunks) == 2
    spans = exporter.get_finished_spans()
    assert len(spans) == 1  # exactly once
    span = spans[0]
    assert span.name == "chat qwen"
    assert span.status.status_code == StatusCode.OK
    attrs = dict(span.attributes)
    assert attrs[extractor.GEN_AI_USAGE_INPUT_TOKENS] == 12
    assert attrs[extractor.GEN_AI_USAGE_OUTPUT_TOKENS] == 7
    assert attrs[extractor.GEN_AI_PROVIDER_NAME] == "dashscope"


async def test_on_model_call_non_streaming_success(in_memory_tracing, model):
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        return _response(_usage(3, 4))

    result = await middleware.on_model_call(
        agent=object(),
        input_kwargs={"current_model": model},
        next_handler=next_handler,
    )
    assert isinstance(result, ChatResponse)
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.OK
    assert dict(span.attributes)[extractor.GEN_AI_USAGE_INPUT_TOKENS] == 3


async def test_streaming_cancelled_error_captured(in_memory_tracing, model):
    """CancelledError mid-stream: error span with bounded error.type,
    no exception payload."""
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        async def stream():
            yield _response(None)
            raise asyncio.CancelledError()

        return stream()

    result = await middleware.on_model_call(
        agent=object(),
        input_kwargs={"current_model": model},
        next_handler=next_handler,
    )
    with pytest.raises(asyncio.CancelledError):
        await _drain(result)
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.status.description is None
    assert span.events == ()  # record_exception not called
    attrs = dict(span.attributes)
    assert attrs[extractor.ERROR_TYPE] == "cancelled"


async def test_streaming_typed_timeout_reason(in_memory_tracing, model):
    """P-1 typed cancellation reason flows into error.type."""
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        async def stream():
            yield _response(None)
            raise asyncio.CancelledError(
                cancellation_msg(CANCEL_REASON_TIMEOUT),
            )

        return stream()

    result = await middleware.on_model_call(
        agent=object(),
        input_kwargs={"current_model": model},
        next_handler=next_handler,
    )
    with pytest.raises(asyncio.CancelledError):
        await _drain(result)
    (span,) = exporter.get_finished_spans()
    assert dict(span.attributes)[extractor.ERROR_TYPE] == CANCEL_REASON_TIMEOUT


async def test_on_model_call_error_sanitized(in_memory_tracing, model):
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        raise RuntimeError("upstream 500 with secret payload")

    with pytest.raises(RuntimeError):
        await middleware.on_model_call(
            agent=object(),
            input_kwargs={"current_model": model},
            next_handler=next_handler,
        )
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.status.description is None
    assert span.events == ()
    assert dict(span.attributes)[extractor.ERROR_TYPE] == "RuntimeError"


async def test_wrap_stream_never_ends_span_twice(in_memory_tracing):
    """Even when the consumer abandons the stream mid-way (aclose), the
    span ends exactly once."""
    provider, exporter = in_memory_tracing
    tracer = otel_trace.get_tracer("test")

    async def stream():
        yield _response(None)
        yield _response(_usage(1, 1))

    span = tracer.start_span("op")
    wrapped = _wrap_streamed_model_call(stream(), span)
    first = await anext(wrapped)
    assert first is not None
    await wrapped.aclose()  # consumer stops early
    assert len(exporter.get_finished_spans()) == 1


# ---------------------------------------------------------------------------
# middleware: reply + acting lifecycles
# ---------------------------------------------------------------------------


async def test_on_reply_span_lifecycle(in_memory_tracing):
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()
    payload = _msg(name="u", role="user", text="hello SECRET-USER-INPUT")

    async def next_handler(**kwargs):
        yield payload
        yield _msg(text="world SECRET-AGENT-OUTPUT")

    items = await _drain(
        middleware.on_reply(
            agent=object(),
            input_kwargs={},
            next_handler=next_handler,
        ),
    )
    assert len(items) == 2
    (span,) = exporter.get_finished_spans()
    assert span.name == "invoke_agent"
    assert span.status.status_code == StatusCode.OK
    # message content must not be recorded
    text = str(dict(span.attributes))
    assert "SECRET-USER-INPUT" not in text
    assert "SECRET-AGENT-OUTPUT" not in text


async def test_on_reply_cancelled_error(in_memory_tracing):
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        yield _msg(text="partial")
        raise asyncio.CancelledError(
            cancellation_msg(CANCEL_REASON_TIMEOUT),
        )

    with pytest.raises(asyncio.CancelledError):
        await _drain(
            middleware.on_reply(
                agent=object(),
                input_kwargs={},
                next_handler=next_handler,
            ),
        )
    (span,) = exporter.get_finished_spans()
    assert span.status.status_code == StatusCode.ERROR
    assert span.events == ()
    assert dict(span.attributes)[extractor.ERROR_TYPE] == CANCEL_REASON_TIMEOUT


async def test_on_acting_tool_span_metadata_only(in_memory_tracing):
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def next_handler(**kwargs):
        yield _msg(name="tool", text="TOOL RESULT SECRET")

    items = await _drain(
        middleware.on_acting(
            agent=object(),
            input_kwargs={"tool_call": _tool_call()},
            next_handler=next_handler,
        ),
    )
    assert len(items) == 1
    (span,) = exporter.get_finished_spans()
    assert span.name == "execute_tool search"
    attrs = dict(span.attributes)
    assert attrs[extractor.GEN_AI_TOOL_NAME] == "search"
    # tool arguments and results are forbidden
    assert set(attrs) <= extractor.ALLOWED_ATTRIBUTE_KEYS
    assert "TOP SECRET argument" not in str(attrs.values())
    assert "TOOL RESULT SECRET" not in str(attrs.values())


async def test_middleware_noop_without_sdk_provider():
    """Without a real SDK provider every hook short-circuits."""
    middleware = MetadataOnlyTracingMiddleware()
    sentinel = _response(_usage())

    async def next_handler(**kwargs):
        return sentinel

    # Force the no-SDK branch by pointing at the proxy provider.
    prev = otel_trace._TRACER_PROVIDER
    otel_trace._TRACER_PROVIDER = None
    try:
        result = await middleware.on_model_call(
            agent=object(),
            input_kwargs={"current_model": object()},
            next_handler=next_handler,
        )
        assert result is sentinel
    finally:
        otel_trace._TRACER_PROVIDER = prev


# ---------------------------------------------------------------------------
# allowlist compliance across all span kinds
# ---------------------------------------------------------------------------


async def test_all_spans_respect_allowlist(in_memory_tracing, model):
    """Drive reply → model call (streaming) → tool call end to end and
    assert every exported span stays inside the metadata allowlist and
    carries no forbidden key."""
    provider, exporter = in_memory_tracing
    middleware = MetadataOnlyTracingMiddleware()

    async def model_handler(**kwargs):
        async def stream():
            yield _response(_usage(5, 6))

        return stream()

    async def acting_handler(**kwargs):
        yield _msg(name="tool", text="result")

    async def reply_handler(**kwargs):
        model_result = await middleware.on_model_call(
            agent=object(),
            input_kwargs={"current_model": model},
            next_handler=model_handler,
        )
        async for _chunk in model_result:
            pass
        async for item in middleware.on_acting(
            agent=object(),
            input_kwargs={"tool_call": _tool_call()},
            next_handler=acting_handler,
        ):
            yield item
        yield _msg(text="final answer")

    await _drain(
        middleware.on_reply(
            agent=object(),
            input_kwargs={},
            next_handler=reply_handler,
        ),
    )
    spans = exporter.get_finished_spans()
    assert len(spans) == 3
    for span in spans:
        keys = set(dict(span.attributes))
        assert (
            keys <= extractor.ALLOWED_ATTRIBUTE_KEYS
        ), f"{span.name}: unexpected keys {keys}"
        assert (
            not keys & extractor.FORBIDDEN_ATTRIBUTE_KEYS
        ), f"{span.name}: forbidden keys {keys}"
        # no exception events anywhere
        assert span.events == ()
        assert span.status.description is None


# ---------------------------------------------------------------------------
# http_middleware (§4.2 receiving side)
# ---------------------------------------------------------------------------


async def _run_asgi(middleware, headers=(), status=200, raises=None):
    sent = []

    async def app(scope, receive, send):
        if raises is not None:
            raise raises
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [],
            },
        )
        await send({"type": "http.response.end"})

    wrapped = middleware(app)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/healthz",
        "headers": headers,
    }

    async def receive():
        return {"type": "http.request"}

    async def send(message):
        sent.append(message)

    await wrapped(scope, receive, send)
    return sent


async def test_server_span_from_traceparent(in_memory_tracing):
    """Inbound traceparent is extracted: the SERVER span joins the
    caller's trace with the caller span as parent."""
    provider, exporter = in_memory_tracing
    tracer = otel_trace.get_tracer("test")
    carrier: dict[str, str] = {}
    with tracer.start_as_current_span("caller"):
        TraceContextTextMapPropagator().inject(carrier)
        parent_span = otel_trace.get_current_span()
        parent_ctx = parent_span.get_span_context()
    # The caller span also went to the same exporter; keep only spans
    # produced by the ASGI pass below.
    exporter.clear()
    headers = [
        (name.encode(), value.encode()) for name, value in carrier.items()
    ]
    sent = await _run_asgi(HttpTracingMiddleware, headers=headers)

    assert [m["type"] for m in sent] == [
        "http.response.start",
        "http.response.end",
    ]
    (server_span,) = exporter.get_finished_spans()
    assert server_span.name == "http GET"
    server_ctx = server_span.get_span_context()
    assert server_ctx.trace_id == parent_ctx.trace_id
    assert server_span.parent is not None
    assert server_span.parent.span_id == parent_ctx.span_id
    attrs = dict(server_span.attributes)
    assert attrs["http.request.method"] == "GET"
    assert attrs["http.response.status_code"] == 200


async def test_server_span_no_traceparent_starts_root(in_memory_tracing):
    provider, exporter = in_memory_tracing
    await _run_asgi(HttpTracingMiddleware)
    (server_span,) = exporter.get_finished_spans()
    assert server_span.parent is None
    assert server_span.get_span_context().is_valid


async def test_server_span_error_sanitized(in_memory_tracing):
    provider, exporter = in_memory_tracing
    with pytest.raises(RuntimeError):
        await _run_asgi(
            HttpTracingMiddleware,
            raises=RuntimeError("db password=hunter2"),
        )
    (server_span,) = exporter.get_finished_spans()
    assert server_span.status.status_code == StatusCode.ERROR
    assert server_span.status.description is None
    assert server_span.events == ()
    assert "hunter2" not in str(dict(server_span.attributes).values())


async def test_server_span_500_status_error(in_memory_tracing):
    provider, exporter = in_memory_tracing
    await _run_asgi(HttpTracingMiddleware, status=500)
    (server_span,) = exporter.get_finished_spans()
    assert server_span.status.status_code == StatusCode.ERROR
    assert dict(server_span.attributes)["http.response.status_code"] == 500


async def test_non_http_scope_passthrough(in_memory_tracing):
    provider, exporter = in_memory_tracing
    seen = []

    async def app(scope, receive, send):
        seen.append(scope)

    middleware = HttpTracingMiddleware(app)

    async def receive():
        return {}

    async def send(message):
        pass

    await middleware({"type": "websocket"}, receive, send)
    assert len(seen) == 1
    assert exporter.get_finished_spans() == ()


# ---------------------------------------------------------------------------
# setup (§4.3 / §4.4)
# ---------------------------------------------------------------------------


@pytest.fixture
def reset_tracing_module(monkeypatch):
    """Reset the module-level provider cache and otel set-once guard."""
    from opentelemetry.util._once import Once

    monkeypatch.setattr(tracing_setup, "_PROVIDER", None)
    monkeypatch.setattr(otel_trace, "_TRACER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(otel_trace, "_TRACER_PROVIDER", None)
    yield


async def test_setup_no_endpoint_installs_provider_with_warning(
    monkeypatch,
    caplog,
    reset_tracing_module,
):
    monkeypatch.setenv("QPQAT_TRACING_ENABLED", "true")
    monkeypatch.delenv("QPQAT_OTLP_ENDPOINT", raising=False)
    with caplog.at_level("WARNING"):
        provider = tracing_setup.setup_tracing()
    assert provider is not None
    assert isinstance(otel_trace.get_tracer_provider(), TracerProvider)
    assert "dropped" in caplog.text
    tracing_setup.shutdown_tracing()


async def test_setup_grpc_endpoint_installs_exporter(
    monkeypatch,
    reset_tracing_module,
):
    monkeypatch.setenv("QPQAT_TRACING_ENABLED", "true")
    monkeypatch.setenv("QPQAT_OTLP_ENDPOINT", "collector-gateway:4317")
    provider = tracing_setup.setup_tracing()
    assert provider is not None
    # one span processor (the batched OTLP exporter) is attached
    processors = getattr(provider, "_active_span_processor", None)
    assert processors is not None
    tracing_setup.shutdown_tracing()


async def test_setup_idempotent(monkeypatch, reset_tracing_module):
    monkeypatch.setenv("QPQAT_OTLP_ENDPOINT", "collector-gateway:4317")
    first = tracing_setup.setup_tracing()
    second = tracing_setup.setup_tracing()
    assert first is second
    tracing_setup.shutdown_tracing()


async def test_shutdown_is_safe_when_not_set_up(reset_tracing_module):
    tracing_setup.shutdown_tracing()  # must not raise
    tracing_setup.shutdown_tracing()


async def test_setup_http_protocol(monkeypatch, reset_tracing_module):
    monkeypatch.setenv("QPQAT_OTLP_ENDPOINT", "http://gateway:4318")
    monkeypatch.setenv("QPQAT_OTLP_PROTOCOL", "http")
    provider = tracing_setup.setup_tracing()
    assert provider is not None
    tracing_setup.shutdown_tracing()
