# -*- coding: utf-8 -*-
"""Metadata-only span attribute extraction (v2.0 §4.1).

Replaces the agentscope default extractor
(``agentscope.middleware._tracing._extractor``), which records input
and output messages, tool call arguments and results — a privacy risk.
This extractor emits ONLY allowlisted metadata:

- model family / provider name
- token counts
- duration (intrinsic to span start/end timestamps)
- error type (class-derived or typed cancellation reason)
- tool name
- status

Forbidden by construction (never produced here):

- ``gen_ai.input.messages`` / ``gen_ai.output.messages``
- ``gen_ai.tool.call.arguments`` / ``gen_ai.tool.call.result``
- ``gen_ai.tool.definitions`` / ``gen_ai.tool.description``
- agent description / conversation id / response id / generation
  parameters (temperature, seed, ...) — identifiers and free text
  are out of the §4.1 allowlist.

Error handling never calls ``record_exception`` and never puts
``str(exception)`` into a status description or attribute; only the
exception *type* (and the typed cancellation reason from
:mod:`qwenpaw.utils.cancellation`) is recorded.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, TYPE_CHECKING

from opentelemetry.trace import Span, StatusCode

from qwenpaw.observability.metrics.allowlist import map_model_family
from qwenpaw.utils.cancellation import extract_cancellation_reason

if TYPE_CHECKING:
    from agentscope.model import ChatModelBase, ChatResponse

# ---------------------------------------------------------------------------
# Attribute keys (allowlisted, v2.0 §4.1)
# ---------------------------------------------------------------------------

GEN_AI_OPERATION_NAME = "gen_ai.operation.name"
GEN_AI_PROVIDER_NAME = "gen_ai.provider.name"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
GEN_AI_TOOL_NAME = "gen_ai.tool.name"
ERROR_TYPE = "error.type"

#: Model family bucket shared with the metrics allowlist so traces and
#: dashboards join on the same family values (qwen/deepseek/glm/openai
#: /other). Raw model names never become a span value.
QPQAT_MODEL_FAMILY = "qpqat.model.family"

#: Type-derived error summary (class qualname or cancellation reason).
#: Derived solely from ``type(exc)`` / typed reason — never from the
#: exception message or traceback, so it cannot carry secrets or user
#: content.
QPQAT_ERROR_SUMMARY = "qpqat.error.summary"

#: Cache token counts (token-count category, §4.1).
QPQAT_CACHE_INPUT_TOKENS = "agentscope.usage.cache_input_tokens"
QPQAT_CACHE_CREATION_INPUT_TOKENS = (
    "agentscope.usage.cache_creation_input_tokens"
)

#: Pending tool *names* on an agent span (tool-name category).
QPQAT_HITL_PENDING_TOOLS = "agentscope.agent.hitl_pending_tools"
QPQAT_EXTERNAL_PENDING_TOOLS = (
    "agentscope.agent.external_execution_pending_tools"
)

#: Operation name values (GenAI semantic conventions).
OP_CHAT = "chat"
OP_INVOKE_AGENT = "invoke_agent"
OP_EXECUTE_TOOL = "execute_tool"

#: Error type recorded for untyped cancellations.
ERROR_TYPE_CANCELLED = "cancelled"

#: Complete attribute key allowlist. Tests assert every span produced
#: by this package stays inside this set.
ALLOWED_ATTRIBUTE_KEYS = frozenset(
    {
        GEN_AI_OPERATION_NAME,
        GEN_AI_PROVIDER_NAME,
        GEN_AI_USAGE_INPUT_TOKENS,
        GEN_AI_USAGE_OUTPUT_TOKENS,
        GEN_AI_TOOL_NAME,
        ERROR_TYPE,
        QPQAT_MODEL_FAMILY,
        QPQAT_ERROR_SUMMARY,
        QPQAT_CACHE_INPUT_TOKENS,
        QPQAT_CACHE_CREATION_INPUT_TOKENS,
        QPQAT_HITL_PENDING_TOOLS,
        QPQAT_EXTERNAL_PENDING_TOOLS,
    },
)

#: Attribute keys the agentscope default extractor emits that must
#: never appear on QwenPaw spans (privacy contract, §4.1).
FORBIDDEN_ATTRIBUTE_KEYS = frozenset(
    {
        "gen_ai.input.messages",
        "gen_ai.output.messages",
        "gen_ai.tool.call.arguments",
        "gen_ai.tool.call.result",
        "gen_ai.tool.definitions",
        "gen_ai.tool.description",
        "gen_ai.agent.description",
        "gen_ai.conversation.id",
        "gen_ai.response.id",
        "gen_ai.request.model",
        "gen_ai.request.temperature",
        "gen_ai.request.top_p",
        "gen_ai.request.top_k",
        "gen_ai.request.max_tokens",
        "gen_ai.request.seed",
        "agentscope.agent.reply_id",
    },
)


# ---------------------------------------------------------------------------
# Provider mapping (metadata-only, mirrors agentscope semantics)
# ---------------------------------------------------------------------------

_CLASS_NAME_MAP = {
    "dashscope": "dashscope",
    "openai": "openai",
    "anthropic": "anthropic",
    "gemini": "gcp_gemini",
    "ollama": "ollama",
    "deepseek": "deepseek",
    "xai": "xai",
    "moonshot": "moonshot",
}

#: Base-URL fragments distinguishing providers behind OpenAI-compatible
#: APIs.
_BASE_URL_PROVIDER_MAP = (
    ("api.openai.com", "openai"),
    ("dashscope", "dashscope"),
    ("deepseek", "deepseek"),
    ("moonshot", "moonshot"),
    ("generativelanguage.googleapis.com", "gcp_gemini"),
    ("openai.azure.com", "azure_ai_openai"),
    ("amazonaws.com", "aws_bedrock"),
    ("api.x.ai", "xai"),
)


def get_provider_name(model: "ChatModelBase") -> str:
    """Map a chat model instance to its provider name (metadata only)."""
    classname = type(model).__name__
    prefix_key = (
        classname.removesuffix("ChatModel")
        .removesuffix("MultiAgentModel")
        .removesuffix("ResponseModel")
        .lower()
    )
    if prefix_key == "openai":
        base_url = getattr(
            getattr(model, "credential", None),
            "base_url",
            None,
        )
        if base_url:
            lowered = str(base_url)
            for fragment, provider in _BASE_URL_PROVIDER_MAP:
                if fragment in lowered:
                    return provider
        return "openai"
    return _CLASS_NAME_MAP.get(prefix_key, "unknown")


def get_model_family(model: "ChatModelBase") -> str:
    """Map the model name to the metrics model-family bucket."""
    return map_model_family(getattr(model, "model", None))


# ---------------------------------------------------------------------------
# Span names (sanitized: family/tool name only, never raw identifiers)
# ---------------------------------------------------------------------------


def chat_span_name(model: "ChatModelBase") -> str:
    """Span name ``chat {model_family}`` (raw model name excluded)."""
    return f"{OP_CHAT} {get_model_family(model)}"


def agent_span_name() -> str:
    """Span name ``invoke_agent`` (agent identity stays in the resource
    ``service.name``, not in span content)."""
    return OP_INVOKE_AGENT


def tool_span_name(tool_name: Optional[str]) -> str:
    """Span name ``execute_tool {tool_name}``."""
    return f"{OP_EXECUTE_TOOL} {tool_name or 'unknown'}"


# ---------------------------------------------------------------------------
# Attribute extractors (allowlisted)
# ---------------------------------------------------------------------------


def chat_request_attributes(model: "ChatModelBase") -> Dict[str, Any]:
    """Allowlisted attributes for a chat span's request side."""
    return {
        GEN_AI_OPERATION_NAME: OP_CHAT,
        GEN_AI_PROVIDER_NAME: get_provider_name(model),
        QPQAT_MODEL_FAMILY: get_model_family(model),
    }


def chat_response_attributes(
    chat_response: Optional["ChatResponse"],
) -> Dict[str, Any]:
    """Allowlisted attributes from a chat response: token counts only.

    No response id, no finish reasons, no output messages.
    """
    attributes: Dict[str, Any] = {}
    usage = getattr(chat_response, "usage", None)
    if usage is None:
        return attributes
    input_tokens = getattr(usage, "input_tokens", None)
    output_tokens = getattr(usage, "output_tokens", None)
    if input_tokens is not None:
        attributes[GEN_AI_USAGE_INPUT_TOKENS] = input_tokens
    if output_tokens is not None:
        attributes[GEN_AI_USAGE_OUTPUT_TOKENS] = output_tokens
    cache_input = getattr(usage, "cache_input_tokens", None)
    if cache_input:
        attributes[QPQAT_CACHE_INPUT_TOKENS] = cache_input
    cache_creation = getattr(usage, "cache_creation_input_tokens", None)
    if cache_creation:
        attributes[QPQAT_CACHE_CREATION_INPUT_TOKENS] = cache_creation
    return attributes


def tool_request_attributes(tool_name: Optional[str]) -> Dict[str, Any]:
    """Allowlisted attributes for a tool span: operation + tool name.

    No call id, no arguments, no description.
    """
    attributes: Dict[str, Any] = {GEN_AI_OPERATION_NAME: OP_EXECUTE_TOOL}
    if tool_name:
        attributes[GEN_AI_TOOL_NAME] = tool_name
    return attributes


def agent_request_attributes() -> Dict[str, Any]:
    """Allowlisted attributes for an agent reply span: operation only.

    No agent name/description, no input messages.
    """
    return {GEN_AI_OPERATION_NAME: OP_INVOKE_AGENT}


# ---------------------------------------------------------------------------
# Error recording (sanitized, §4.1)
# ---------------------------------------------------------------------------


def error_type_of(exc: BaseException) -> str:
    """Classify *exc* into a bounded ``error.type`` value.

    Typed QwenPaw cancellations map to their reason (``timeout`` /
    ``user_stop``), plain cancellations to ``cancelled``; everything
    else maps to the exception class qualname. No message content is
    ever consulted.
    """
    reason = extract_cancellation_reason(exc)
    if reason is not None:
        return reason
    import asyncio

    if isinstance(exc, asyncio.CancelledError):
        return ERROR_TYPE_CANCELLED
    return type(exc).__qualname__


def set_span_error(span: "Span", exc: BaseException) -> None:
    """Mark *span* failed without leaking message or stack.

    - status set to ERROR **without** a description (the default
      agentscope path passes ``str(exc)`` as description);
    - ``error.type`` and a type-derived ``qpqat.error.summary`` are
      recorded;
    - ``record_exception`` is deliberately NOT called (it would embed
      the raw message and traceback into the span).
    """
    summary = type(exc).__qualname__
    span.set_attribute(ERROR_TYPE, error_type_of(exc))
    span.set_attribute(QPQAT_ERROR_SUMMARY, summary)
    span.set_status(StatusCode.ERROR)
    span.end()


def set_span_success(span: "Span") -> None:
    """Mark *span* OK and end it."""
    span.set_status(StatusCode.OK)
    span.end()
