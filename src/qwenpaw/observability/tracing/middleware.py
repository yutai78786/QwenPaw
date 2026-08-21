# -*- coding: utf-8 -*-
"""Metadata-only tracing middleware (v2.0 §4.1).

Self-contained re-implementation of the agentscope 2.0.6
``middleware._tracing`` lifecycle seam with the default extractor
replaced by the allowlisted extractor
(:mod:`qwenpaw.observability.tracing.extractor`).

Why not subclass ``TracingMiddleware``:

- the default class module-imports the privacy-violating extractor and
  its error path records ``str(exception)`` plus the full traceback via
  ``record_exception``;
- QwenPaw pins agentscope versions whose ``_trace.py`` internals drift
  (2.0.4.post1 vs 2.0.6), so the seam contract is replicated here
  against stable ``MiddlewareBase`` hooks instead.

Lifecycle seam (matches agentscope 2.0.6):

- spans are started with ``start_span`` and kept as *parents* via
  ``set_span_in_context`` without holding the OTel context across
  ``yield`` boundaries — the context token is attached/detached within
  each ``__anext__`` step, so a generator closed from another asyncio
  task never raises OTel detach errors (agentscope issue #2076);
- the model-call async generator is wrapped so response attributes are
  taken from the last streamed chunk and the span ends exactly once in
  ``finally``;
- error paths set status ERROR **without** a description and never call
  ``record_exception`` (§4.1).

When the global tracer provider is not a real SDK provider (tracing
not set up), every hook short-circuits with near-zero overhead.
"""
from __future__ import annotations

from typing import (
    Any,
    AsyncGenerator,
    Awaitable,
    Callable,
    Union,
    TYPE_CHECKING,
)

from agentscope.middleware import MiddlewareBase
from agentscope.message import ToolCallBlock
from agentscope.model import ChatModelBase
from opentelemetry import context as otel_context
from opentelemetry import trace as otel_trace

from .extractor import (
    QPQAT_EXTERNAL_PENDING_TOOLS,
    QPQAT_HITL_PENDING_TOOLS,
    agent_request_attributes,
    agent_span_name,
    chat_request_attributes,
    chat_response_attributes,
    chat_span_name,
    set_span_error,
    set_span_success,
    tool_request_attributes,
    tool_span_name,
)

if TYPE_CHECKING:
    from opentelemetry.trace import Span

    from agentscope.agent import Agent
    from agentscope.model import ChatResponse


def _sdk_tracing_active() -> bool:
    """True when a real SDK TracerProvider is installed globally."""
    try:
        from opentelemetry.sdk.trace import TracerProvider
    except ImportError:
        return False
    return isinstance(otel_trace.get_tracer_provider(), TracerProvider)


def _tracer() -> Any:
    """QwenPaw tracer (service-level instrumentation scope)."""
    return otel_trace.get_tracer("qwenpaw")


async def _wrap_streamed_model_call(
    stream: AsyncGenerator["ChatResponse", None],
    span: "Span",
) -> AsyncGenerator["ChatResponse", None]:
    """Yield *stream* unchanged; finalise *span* from the last chunk.

    Response attributes (token counts) come from the last streamed
    chunk; the span ends exactly once — on exception via the sanitized
    error path, otherwise as success in ``finally``.
    """
    has_error = False
    last_chunk: "ChatResponse | None" = None
    try:
        async for chunk in stream:
            last_chunk = chunk
            yield chunk
    except BaseException as exc:
        has_error = True
        set_span_error(span, exc)
        raise
    finally:
        if not has_error:
            span.set_attributes(chat_response_attributes(last_chunk))
            set_span_success(span)


def _emit_external_tool_spans(
    tracer: Any,
    span_context: Any,
    input_kwargs: dict,
) -> None:
    """Emit synthetic execute_tool spans for externally executed tools.

    Tool NAME only — the execution result payload is never read.
    """
    try:
        from agentscope.event import ExternalExecutionResultEvent
    except ImportError:  # pragma: no cover - event type always present
        return
    event_arg = input_kwargs.get("inputs")
    if not isinstance(event_arg, ExternalExecutionResultEvent):
        return
    for result in event_arg.execution_results:
        with tracer.start_as_current_span(
            name=tool_span_name(result.name),
            attributes=tool_request_attributes(result.name),
            context=span_context,
        ):
            pass


class MetadataOnlyTracingMiddleware(MiddlewareBase):
    """OpenTelemetry tracing middleware emitting allowlisted metadata.

    Spans cover the three agentscope lifecycles — agent reply, model
    call, tool execution — with span content restricted to the v2.0
    §4.1 allowlist (model family / token counts / duration / error
    type / tool name / status).

    ``agent`` is part of the ``MiddlewareBase`` hook signature but is
    deliberately unused: agent identity is carried by the
    ``service.name`` resource attribute, not by span content.
    """

    # pylint: disable=unused-argument

    # ------------------------------------------------------------------
    # on_reply
    # ------------------------------------------------------------------
    async def on_reply(
        self,
        agent: "Agent",
        input_kwargs: dict,
        next_handler: Callable[..., AsyncGenerator],
    ) -> AsyncGenerator:
        if not _sdk_tracing_active():
            async for item in next_handler(**input_kwargs):
                yield item
            return

        tracer = _tracer()
        span = tracer.start_span(
            name=agent_span_name(),
            attributes=agent_request_attributes(),
        )
        # Parent context for downstream spans; never held across yield
        # boundaries (issue #2076 pattern).
        span_context = otel_trace.set_span_in_context(span)

        _emit_external_tool_spans(tracer, span_context, input_kwargs)

        from agentscope.event import (
            RequireExternalExecutionEvent,
            RequireUserConfirmEvent,
        )

        has_error = False
        error_exc: BaseException | None = None
        hitl_pending: list[str] = []
        external_pending: list[str] = []

        gen = next_handler(**input_kwargs)
        try:
            while True:
                token = otel_context.attach(span_context)
                try:
                    item = await anext(gen)
                except StopAsyncIteration:
                    break
                finally:
                    otel_context.detach(token)

                if isinstance(item, RequireUserConfirmEvent):
                    hitl_pending.extend(tool.name for tool in item.tool_calls)
                elif isinstance(item, RequireExternalExecutionEvent):
                    external_pending.extend(
                        tool.name for tool in item.tool_calls
                    )
                yield item
        except BaseException as exc:
            has_error = True
            error_exc = exc
            raise
        finally:
            if hitl_pending:
                span.set_attribute(
                    QPQAT_HITL_PENDING_TOOLS,
                    ",".join(sorted(set(hitl_pending))),
                )
            if external_pending:
                span.set_attribute(
                    QPQAT_EXTERNAL_PENDING_TOOLS,
                    ",".join(sorted(set(external_pending))),
                )
            if has_error and error_exc is not None:
                set_span_error(span, error_exc)
            else:
                set_span_success(span)

    # ------------------------------------------------------------------
    # on_model_call
    # ------------------------------------------------------------------
    async def on_model_call(
        self,
        agent: "Agent",
        input_kwargs: dict,
        next_handler: Callable[
            ...,
            Awaitable[
                Union["ChatResponse", AsyncGenerator["ChatResponse", None]],
            ],
        ],
    ) -> Union["ChatResponse", AsyncGenerator["ChatResponse", None]]:
        if not _sdk_tracing_active():
            return await next_handler(**input_kwargs)

        model = input_kwargs.get("current_model")
        if not isinstance(model, ChatModelBase):
            return await next_handler(**input_kwargs)

        tracer = _tracer()
        with tracer.start_as_current_span(
            name=chat_span_name(model),
            attributes=chat_request_attributes(model),
            end_on_exit=False,
        ) as span:
            try:
                result = await next_handler(**input_kwargs)
                if isinstance(result, AsyncGenerator):
                    return _wrap_streamed_model_call(result, span)
                span.set_attributes(chat_response_attributes(result))
                set_span_success(span)
                return result
            except BaseException as exc:
                set_span_error(span, exc)
                raise

    # ------------------------------------------------------------------
    # on_acting
    # ------------------------------------------------------------------
    async def on_acting(
        self,
        agent: "Agent",
        input_kwargs: dict,
        next_handler: Callable[..., AsyncGenerator],
    ) -> AsyncGenerator:
        if not _sdk_tracing_active():
            async for item in next_handler(**input_kwargs):
                yield item
            return

        tool_call = input_kwargs.get("tool_call")
        if not isinstance(tool_call, ToolCallBlock):
            async for item in next_handler(**input_kwargs):
                yield item
            return

        tracer = _tracer()
        span = tracer.start_span(
            name=tool_span_name(tool_call.name),
            attributes=tool_request_attributes(tool_call.name),
        )
        span_context = otel_trace.set_span_in_context(span)

        has_error = False
        gen = next_handler(**input_kwargs)
        try:
            while True:
                token = otel_context.attach(span_context)
                try:
                    item = await anext(gen)
                except StopAsyncIteration:
                    break
                finally:
                    otel_context.detach(token)
                yield item
        except BaseException as exc:
            has_error = True
            set_span_error(span, exc)
            raise
        finally:
            if not has_error:
                set_span_success(span)
