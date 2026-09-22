# -*- coding: utf-8 -*-
"""Tool function schemas must reach the model wire (GH#7210).

GH#7210 reported that every tool was enabled in agent.json yet the tool
function schemas were not injected when the session was built, so the model
could not call anything.

The configuration surface cannot prove this: ``GET
/api/agents/{agentId}/tools`` returns ``ToolInfo`` (routers/tools.py:63),
whose fields are name / enabled / description / async_execution / icon /
requires_config / config_fields / config_values.  There is no ``parameters``
and no ``title`` field, so an assertion about JSON Schema made against that
endpoint can only ever be dead code.

These cases therefore assert on the payload the app actually sends to the
model.  ``MockLLMHandler`` records every request body it receives
(``server.last_bodies``), and the wire shape is fixed by AgentScope
(``agentscope/tool/_types.py:79-85``):

    {"type": "function",
     "function": {"name": ..., "description": ..., "parameters": {...}}}

Coverage targets:
    - every injected tool is a well-formed function schema
    - at least one carries a real, non-empty argument schema
    - disabling a tool removes it from the wire and re-enabling restores it
      (the config -> injection link that GH#7210 says was broken)
    - no tool that is disabled in config ever reaches the wire
    - a tool the agent really calls was present in the injected schemas

API endpoints:
    - POST /api/console/chat/task        (drives a full agent turn)
    - GET  /api/console/chat/task/{id}   (poll to completion)
    - GET  /api/agents                   (resolve the default agent id)
    - GET  /api/agents/{id}/tools        (tool config: name + enabled)
    - PATCH /api/agents/{id}/tools/{n}/toggle  (stateful flip)
"""
from __future__ import annotations

import json
import threading
import time
from http.server import HTTPServer

import pytest
from helpers import (
    MOCK_LLM_PROVIDER_ID,
    MockLLMHandler,
    default_http_timeout,
    register_mock_provider,
    unregister_mock_provider,
)

_HTTP_TIMEOUT = default_http_timeout(60.0)


@pytest.fixture(scope="module")
def mock_llm():
    """Module-scoped mock OpenAI server that records request bodies."""
    srv = HTTPServer(("127.0.0.1", 0), MockLLMHandler)
    srv.force_error = False
    srv.force_tool_call = False
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, f"http://127.0.0.1:{port}/v1"
    srv.shutdown()


def _default_agent_id(app_server) -> str:
    """Return the id of the agent named 'default'."""
    resp = app_server.api_request("GET", "/api/agents", timeout=_HTTP_TIMEOUT)
    assert resp.status_code == 200, app_server.logs_tail()[-2000:]
    agents = resp.json().get("agents", [])
    assert agents, f"no agents configured: {resp.text[:500]}"
    match = next((a for a in agents if a.get("id") == "default"), None)
    assert (
        match is not None
    ), f"no 'default' agent in {[a.get('id') for a in agents]}"
    return match["id"]


def _config_enabled_tools(app_server, agent_id: str) -> set:
    """Return tool names whose config says enabled is True."""
    resp = app_server.api_request(
        "GET",
        f"/api/agents/{agent_id}/tools",
        timeout=_HTTP_TIMEOUT,
    )
    assert resp.status_code == 200, app_server.logs_tail()[-2000:]
    tools = resp.json()
    assert isinstance(tools, list), f"tools payload is not a list: {tools!r}"
    return {t["name"] for t in tools if t.get("enabled") is True}


def _set_tool_enabled(app_server, agent_id: str, name: str, enabled: bool):
    """Idempotently set a tool's enabled flag.

    ``PATCH /tools/{name}/toggle`` is a stateful flip that ignores the body
    (see test_acp_runner.py:108), so read the current value first and only
    toggle when a flip is really needed.  Two blind toggles would cancel
    out and leave the tool in the wrong state.
    """
    resp = app_server.api_request(
        "GET",
        f"/api/agents/{agent_id}/tools",
        timeout=_HTTP_TIMEOUT,
    )
    assert resp.status_code == 200, app_server.logs_tail()[-2000:]
    current = {t["name"]: t.get("enabled") for t in resp.json()}
    assert (
        name in current
    ), f"{name} not in tool config: {sorted(current)[:40]}"
    if current[name] is enabled:
        return
    flip = app_server.api_request(
        "PATCH",
        f"/api/agents/{agent_id}/tools/{name}/toggle",
        timeout=_HTTP_TIMEOUT,
    )
    assert flip.status_code == 200, (
        f"toggle {name} failed: {flip.status_code} "
        f"{app_server.logs_tail()[-1500:]}"
    )


def _run_turn(app_server, srv, mock_url, user_id: str, text: str):
    """Register the mock provider, drive one turn, return its wire tools.

    ``srv.last_bodies`` is cleared first so the returned list holds exactly
    the requests issued by this turn.
    """
    srv.last_bodies = []
    srv.last_tools = []
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    provider_id = register_mock_provider(app_server, mock_url)
    try:
        submit = app_server.api_request(
            "POST",
            "/api/console/chat/task",
            json={
                "channel": "console",
                "user_id": user_id,
                "session_id": f"console:{user_id}",
                "input": [
                    {
                        "role": "user",
                        "type": "message",
                        "content": [{"type": "text", "text": text}],
                    },
                ],
                "request_context": {"approval_level": "off"},
            },
            timeout=_HTTP_TIMEOUT,
        )
        assert submit.status_code == 200, app_server.logs_tail()[-2000:]
        task_id = submit.json()["task_id"]

        deadline = time.time() + 240.0
        final = None
        while time.time() < deadline:
            poll = app_server.api_request(
                "GET",
                f"/api/console/chat/task/{task_id}",
                timeout=default_http_timeout(15.0),
            )
            assert poll.status_code == 200, app_server.logs_tail()[-2000:]
            body = poll.json()
            if body.get("status") == "finished":
                final = body
                break
            time.sleep(0.4)
        assert final is not None, (
            "chat task did not finish: " + app_server.logs_tail()[-2000:]
        )
        return final, _wire_tools(srv)
    finally:
        unregister_mock_provider(app_server, provider_id)


def _wire_tools(srv) -> list:
    """Collect the tools array from every request body of this turn."""
    collected = []
    for body in list(getattr(srv, "last_bodies", None) or []):
        tools = body.get("tools")
        if isinstance(tools, list):
            collected.append(tools)
    assert collected, (
        "the app sent no request carrying a tools array, so nothing was "
        f"injected; request bodies seen: {len(srv.last_bodies)}"
    )
    return collected


def _names_from_wire(wire_turns: list) -> set:
    """Flatten every wire turn into the set of injected tool names."""
    names = set()
    for tools in wire_turns:
        for tool in tools:
            func = tool.get("function") if isinstance(tool, dict) else None
            if isinstance(func, dict) and func.get("name"):
                names.add(func["name"])
    return names


@pytest.mark.integration
@pytest.mark.p1
class TestToolSchemaInjection:
    """The tool schemas the model receives, read off the wire."""

    def test_wire_carries_well_formed_function_schemas(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """Every injected tool matches the AgentScope function-schema shape.

        Test purpose:
            - GH#7210 is about schemas not being injected at all, so the
              first thing to pin down is that a real turn sends a tools
              array whose entries are structurally correct.

        Test flow:
            1. Drive one agent turn against the mock provider.
            2. Assert each tool entry is {"type": "function", "function":
               {name, description, parameters}} with an object-typed
               parameters schema.
        """
        srv, mock_url = mock_llm
        _final, wire = _run_turn(
            app_server,
            srv,
            mock_url,
            "integ-tool-schema-01",
            "hello",
        )

        for turn_index, tools in enumerate(wire):
            assert tools, f"turn {turn_index} sent an empty tools array"
            for tool in tools:
                assert isinstance(
                    tool,
                    dict,
                ), f"tool entry not a dict: {tool!r}"
                assert (
                    tool.get("type") == "function"
                ), f"tool entry has no type=function: {sorted(tool)}"
                func = tool.get("function")
                assert isinstance(
                    func,
                    dict,
                ), f"tool entry has no function object: {sorted(tool)}"
                assert isinstance(
                    func.get("name"),
                    str,
                ), f"function.name missing or not a string: {sorted(func)}"
                assert func["name"], "function.name is empty"
                assert (
                    "description" in func
                ), f"function.description missing for {func['name']}"
                params = func.get("parameters")
                assert isinstance(params, dict), (
                    f"{func['name']}: parameters is not an object schema "
                    f"but {type(params).__name__}"
                )
                assert params.get("type") == "object", (
                    f"{func['name']}: parameters.type is "
                    f"{params.get('type')!r}, expected 'object'"
                )
                assert (
                    "properties" in params
                ), f"{func['name']}: parameters has no 'properties' key"

    def test_at_least_one_tool_has_a_real_argument_schema(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """Injection carries real argument schemas, not empty stubs.

        Test purpose:
            - A regression could inject every tool with an empty
              ``properties`` map; the model would then see the names but be
              unable to build a call.  At least one tool takes arguments
              (read_file, write_file, shell, ...), so assert one has a
              non-empty properties map.

        Test flow:
            1. Drive one turn and collect the wire tools.
            2. Assert some tool declares non-empty properties.
        """
        srv, mock_url = mock_llm
        _final, wire = _run_turn(
            app_server,
            srv,
            mock_url,
            "integ-tool-schema-02",
            "hello",
        )

        with_args = []
        for tools in wire:
            for tool in tools:
                func = tool.get("function") or {}
                props = (func.get("parameters") or {}).get("properties")
                if isinstance(props, dict) and props:
                    with_args.append((func.get("name"), sorted(props)[:4]))
        assert with_args, (
            "every injected tool had an empty properties map, so no "
            "argument schema reached the model"
        )

    def test_disabling_a_tool_removes_it_from_the_wire(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """Config really drives injection: off means absent, on means back.

        Test purpose:
            - This is the exact link GH#7210 says was broken.  Toggling a
              tool in the config surface must change what the model is
              offered, which only a wire-level assertion can show.

        Test flow:
            1. Pick a tool that is enabled in config and present on the wire.
            2. Disable it, drive a turn, assert it is gone from the wire.
            3. Re-enable it (always, via finally), drive a turn, assert it
               is back.
        """
        srv, mock_url = mock_llm
        agent_id = _default_agent_id(app_server)

        _final, wire = _run_turn(
            app_server,
            srv,
            mock_url,
            "integ-tool-schema-03a",
            "hello",
        )
        on_wire = _names_from_wire(wire)
        enabled = _config_enabled_tools(app_server, agent_id)
        candidates = sorted(on_wire & enabled)
        target = (
            "get_current_time"
            if "get_current_time" in candidates
            else (candidates[0] if candidates else None)
        )
        assert target is not None, (
            "no tool was both enabled in config and present on the wire, so "
            f"the toggle cannot be exercised; wire={sorted(on_wire)[:20]}, "
            f"enabled={sorted(enabled)[:20]}"
        )

        try:
            _set_tool_enabled(app_server, agent_id, target, False)
            _final, wire_off = _run_turn(
                app_server,
                srv,
                mock_url,
                "integ-tool-schema-03b",
                "hello",
            )
            names_off = _names_from_wire(wire_off)
            assert target not in names_off, (
                f"{target} is disabled in config but was still injected "
                f"into the model request: {sorted(names_off)[:20]}"
            )
            assert (
                names_off
            ), "disabling one tool removed every tool from the wire"
        finally:
            _set_tool_enabled(app_server, agent_id, target, True)

        _final, wire_on = _run_turn(
            app_server,
            srv,
            mock_url,
            "integ-tool-schema-03c",
            "hello",
        )
        names_on = _names_from_wire(wire_on)
        assert target in names_on, (
            f"{target} was re-enabled in config but is missing from the "
            f"wire: {sorted(names_on)[:20]}"
        )

    def test_no_disabled_tool_reaches_the_wire(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """The wire set is a subset of the enabled config set.

        Test purpose:
            - Sweep the whole roster rather than one tool: anything the
              config reports as not-enabled must never be offered to the
              model.  This is asserted as a subset rather than as equality
              because skills and MCP clients can contribute additional
              wire tools that the tool-config endpoint does not list.

        Test flow:
            1. Drive one turn, collect wire names.
            2. Read the full config roster and split enabled / disabled.
            3. Assert no disabled name appears on the wire.
        """
        srv, mock_url = mock_llm
        agent_id = _default_agent_id(app_server)

        _final, wire = _run_turn(
            app_server,
            srv,
            mock_url,
            "integ-tool-schema-04",
            "hello",
        )
        on_wire = _names_from_wire(wire)

        resp = app_server.api_request(
            "GET",
            f"/api/agents/{agent_id}/tools",
            timeout=_HTTP_TIMEOUT,
        )
        assert resp.status_code == 200, app_server.logs_tail()[-2000:]
        roster = resp.json()
        disabled = {t["name"] for t in roster if t.get("enabled") is not True}
        assert disabled, (
            "every tool in the roster is enabled, so this case cannot "
            "prove anything; the fixture workspace should ship at least "
            "one disabled tool"
        )

        leaked = sorted(on_wire & disabled)
        assert not leaked, (
            f"{len(leaked)} disabled tool(s) were injected into the model "
            f"request: {leaked[:20]}"
        )

    def test_called_tool_was_present_in_the_injected_schemas(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """A tool the agent actually invokes was in the injected schemas.

        Test purpose:
            - Injection is only useful if it matches what the agent can
              call.  Forcing a get_current_time call and then checking that
              the same name carried a valid schema ties the wire payload to
              a real execution path.

        Test flow:
            1. Force the mock LLM to call get_current_time.
            2. Drive the turn to completion.
            3. Assert the schemas sent for that turn included the tool with
               a valid function schema.
        """
        srv, mock_url = mock_llm
        srv.force_tool_call = True
        srv.tool_call_name = "get_current_time"
        srv.tool_call_arguments = "{}"
        try:
            final, wire = _run_turn(
                app_server,
                srv,
                mock_url,
                "integ-tool-schema-05",
                "what time is it",
            )
        finally:
            srv.force_tool_call = False

        assert final.get("status") == "finished", final
        assert "get_current_time" in _names_from_wire(wire), (
            "the agent called get_current_time but it was absent from the "
            "injected schemas; wire names: "
            f"{sorted(_names_from_wire(wire))[:20]}"
        )

        schemas = {}
        for tools in wire:
            for tool in tools:
                func = tool.get("function") or {}
                if func.get("name") == "get_current_time":
                    schemas = func
        assert schemas.get("parameters", {}).get("type") == "object", (
            f"get_current_time was injected without an object parameters "
            f"schema: {json.dumps(schemas)[:400]}"
        )
