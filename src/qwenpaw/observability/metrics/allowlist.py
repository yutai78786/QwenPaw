# -*- coding: utf-8 -*-
"""Label allowlists for ACS monitoring metrics (v2.0 §2.2).

Every label value flows through one of these mechanical maps. Unknown
values collapse to the bucket's ``_other`` sentinel — raw URLs, model
names, exception text or free-form identifiers never reach a label, so
per-Pod cardinality is bounded by the product of the allowlist sizes
(v2.0 §2.3).

Cardinality per metric family (single Pod):

- method: 6 (GET/POST/PUT/DELETE/PATCH/_other)
- route: 21 (20 key route templates + _other)
- status_class: 5 (2xx/3xx/4xx/5xx/other)
- model_family: 5, error_type: 4, channel: 5, outcome: 4
"""
from __future__ import annotations

from typing import Optional

#: Sentinel for any value outside an allowlist.
OTHER = "_other"

_METHOD_ALLOWLIST = frozenset(
    {"GET", "POST", "PUT", "DELETE", "PATCH"},
)

_STATUS_CLASS_ALLOWLIST = ("2xx", "3xx", "4xx", "5xx")

#: Key route templates (v2.0 §2.2: 20 + ``_other``). Values are the
#: normalized Starlette route templates with the ``/api`` prefix
#: re-applied for routers mounted under ``prefix="/api"`` (the mount
#: prefix is not part of ``scope["route"].path``).
#:
#: Selection criteria: interactive chat path (console + agent-scoped),
#: chat/session management, model & auth endpoints, message push,
#: skills, agents, cron, channels config, health, and the public
#: Twilio voice entry.
ROUTE_ALLOWLIST = frozenset(
    {
        # console chat (core interactive path)
        "/api/console/chat",
        "/api/console/chat/stop",
        "/api/console/chat/task",
        "/api/console/chat/task/{task_id}",
        "/api/agents/{agentId}/console/chat",
        # chats management
        "/api/chats",
        "/api/chats/{chat_id}",
        "/api/agents/{agentId}/chats",
        # models
        "/api/models",
        "/api/models/active",
        # auth
        "/api/auth/login",
        "/api/auth/verify",
        # inter-agent / push messages
        "/api/messages/send",
        # agents
        "/api/agents",
        "/api/agents/{agentId}",
        # skills & cron & channels config
        "/api/skills",
        "/api/cron/jobs",
        "/api/config/channels",
        # health
        "/api/healthz",
        # public voice entry (mounted without /api prefix)
        "/voice/incoming",
    },
)

_MODEL_FAMILY_ALLOWLIST = frozenset(
    {"qwen", "deepseek", "glm", "openai"},
)

_WS_ERROR_TYPE_ALLOWLIST = ("handshake", "disconnect", "timeout")

_CHANNEL_ALLOWLIST = frozenset(
    {"console_sse", "voice_ws", "dingtalk", "feishu"},
)

_RUN_OUTCOMES = ("success", "error", "cancelled", "timeout")


def map_method(method: Optional[str]) -> str:
    """Map an HTTP method to its allowlisted value (6 values)."""
    if method is None:
        return OTHER
    normalized = method.upper()
    return normalized if normalized in _METHOD_ALLOWLIST else OTHER


def map_route(route_template: Optional[str]) -> str:
    """Map a Starlette route template to its allowlisted value (21).

    ``None`` (unmatched scope) and everything outside the allowlist
    collapse to ``_other``. Raw request URLs must never be passed in —
    only route templates produced by the router.
    """
    if route_template is not None and route_template in ROUTE_ALLOWLIST:
        return route_template
    return OTHER


_STATUS_CLASS_BY_RANGE = (
    (200, 300, "2xx"),
    (300, 400, "3xx"),
    (400, 500, "4xx"),
    (500, 600, "5xx"),
)


def map_status_class(status_code: Optional[int]) -> str:
    """Map an HTTP status code to 2xx/3xx/4xx/5xx/other (5 values)."""
    if status_code is None:
        return "other"
    try:
        code = int(status_code)
    except (TypeError, ValueError):
        return "other"
    for lower, upper, label in _STATUS_CLASS_BY_RANGE:
        if lower <= code < upper:
            return label
    return "other"


def map_model_family(model_name: Optional[str]) -> str:
    """Map a raw model name to one of 5 model families.

    Matching is substring-based on the lowercase name so that
    ``qwen3-max`` / ``deepseek-v3`` / ``glm-4-plus`` /
    ``openai/gpt-4o`` all land in their family; anything else is
    ``other``. The raw name never becomes a label.
    """
    if not model_name:
        return "other"
    lowered = model_name.lower()
    for family in sorted(_MODEL_FAMILY_ALLOWLIST):
        if family in lowered:
            return family
    return "other"


def map_ws_error_type(error_type: Optional[str]) -> str:
    """Map a WebSocket error classification (4 values)."""
    if error_type in _WS_ERROR_TYPE_ALLOWLIST:
        return error_type
    return OTHER


def map_channel(channel: Optional[str]) -> str:
    """Map a run/message channel to one of 5 values.

    Console SSE runs and voice WebSocket runs are the instrumented
    interactive channels; DingTalk/Feishu are the instrumented IM
    channels; everything else collapses to ``other``.
    """
    if channel is None:
        return OTHER
    normalized = channel.lower()
    if normalized in _CHANNEL_ALLOWLIST:
        return normalized
    if normalized == "console":
        return "console_sse"
    if normalized == "voice":
        return "voice_ws"
    return OTHER


def validate_outcome(outcome: str) -> str:
    """Return *outcome* if it is one of the four terminal outcomes.

    Raises ``ValueError`` for unknown values so outcome misuse fails
    loudly instead of silently inflating cardinality.
    """
    if outcome not in _RUN_OUTCOMES:
        raise ValueError(
            f"outcome must be one of {_RUN_OUTCOMES}, got {outcome!r}",
        )
    return outcome


# ---------------------------------------------------------------------------
# Canonical label value lists (v2.0 §2.2). These tuples enumerate every
# value each label may ever take; the registry uses them to pre-create
# the full bounded series space at import time (v2.0 §2.3: exactly 977
# active series per Pod).
# ---------------------------------------------------------------------------

METHOD_VALUES = tuple(sorted(_METHOD_ALLOWLIST)) + (OTHER,)
STATUS_CLASS_VALUES = _STATUS_CLASS_ALLOWLIST + ("other",)
ROUTE_VALUES = tuple(sorted(ROUTE_ALLOWLIST)) + (OTHER,)
CHANNEL_VALUES = tuple(sorted(_CHANNEL_ALLOWLIST)) + (OTHER,)
OUTCOME_VALUES = _RUN_OUTCOMES
MODEL_FAMILY_VALUES = tuple(sorted(_MODEL_FAMILY_ALLOWLIST)) + ("other",)
WS_ERROR_TYPE_VALUES = _WS_ERROR_TYPE_ALLOWLIST + (OTHER,)
DIRECTION_VALUES = ("inbound", "outbound")
LLM_STATUS_VALUES = ("success", "error")
LLM_TOKEN_TYPE_VALUES = ("prompt", "completion")
