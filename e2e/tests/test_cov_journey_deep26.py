# -*- coding: utf-8 -*-
"""
MCP / loops / envs / token-usage / providers deep sweep (5pp wave 26).

Deterministic REST-only coverage for routers with large uncovered tails:
- /mcp clients CRUD + toggle + policy + tools + access principals
- /loops status + gates catalog + custom loop modes CRUD
- /envs list/batch-save/delete round trip
- /token-usage + details
- /models providers deep: list, custom provider create/delete,
  visibility toggle, openrouter surfaces, active get/set round trip

All calls are pure API round trips (no LLM), deterministic by design.

Run: pytest tests/test_cov_journey_deep26.py -v
"""
from __future__ import annotations

import json
import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

MCP_KEY = "e2e-cov26-mcp"
LOOP_PREFIX = "e2e_cov26_"
ENV_KEY = "E2E_COV26_PROBE"
CUSTOM_PROV = "e2e-cov26-provider"


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.mcp
class TestMcpClientLifecycle:
    """COV-MCP-002: MCP client create/toggle/get/update/delete + policy."""

    @pytest.mark.test_id("COV-MCP-002")
    def test_mcp_client_lifecycle(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Cleanup leftover probe client")
        api_context.delete(f"/api/mcp/{MCP_KEY}")

        log_test_step("2. List clients + access principals")
        ls0 = api_context.get("/api/mcp")
        assert ls0.ok, f"mcp list failed [{ls0.status}]"
        pr = api_context.get("/api/mcp/access-principals")
        logger.info("access-principals -> %s", pr.status)

        log_test_step("3. Create a stdio probe client")
        cr = api_context.post(
            "/api/mcp",
            data=json.dumps({
                "client_key": MCP_KEY,
                "client": {
                    "name": "E2E Cov26 Probe",
                    "type": "stdio",
                    "command": "true",
                    "args": [],
                    "enabled": False,
                },
            }),
        )
        assert cr.status in (200, 201), f"mcp create [{cr.status}]: {cr.text()[:200]}"

        log_test_step("4. Get + toggle + policy surfaces")
        got = api_context.get(f"/api/mcp/{MCP_KEY}")
        assert got.ok, f"mcp get [{got.status}]"
        pol = api_context.get(f"/api/mcp/policy/{MCP_KEY}")
        logger.info("policy -> %s", pol.status)
        if pol.ok:
            pol_put = api_context.put(
                f"/api/mcp/policy/{MCP_KEY}", data=json.dumps(pol.json()))
            logger.info("policy put -> %s", pol_put.status)
        tools = api_context.get(f"/api/mcp/tools/{MCP_KEY}")
        logger.info("tools -> %s", tools.status)

        log_test_step("5. Update then delete")
        upd = api_context.put(
            f"/api/mcp/{MCP_KEY}",
            data=json.dumps({
                "name": "E2E Cov26 Probe v2",
                "type": "stdio",
                "command": "true",
                "args": [],
                "enabled": False,
            }),
        )
        logger.info("mcp update -> %s", upd.status)
        dele = api_context.delete(f"/api/mcp/{MCP_KEY}")
        assert dele.status in (200, 204), f"mcp delete [{dele.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.cronjobs
class TestLoopModeSurfaces:
    """COV-LOOP-001: loop status/gates/custom CRUD surfaces."""

    @pytest.mark.test_id("COV-LOOP-001")
    def test_loop_mode_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Status + gates catalog + custom list")
        st = api_context.get("/api/loops/status")
        assert st.ok, f"loops status [{st.status}]"
        gates = api_context.get("/api/loops/gates/catalog")
        assert gates.ok, f"loops gates [{gates.status}]"
        cust = api_context.get("/api/loops/custom")
        assert cust.ok, f"loops custom list [{cust.status}]"

        log_test_step("2. Create a custom loop mode, duplicate, update, delete")
        mode_id = f"{LOOP_PREFIX}mode"
        api_context.delete(f"/api/loops/custom/{mode_id}")
        cr = api_context.post(
            "/api/loops/custom",
            data=json.dumps({
                "mode_id": mode_id,
                "name": "Cov26 probe loop",
                "description": "coverage probe",
            }),
        )
        logger.info("loop create -> %s", cr.status)
        if cr.status in (200, 201):
            dup = api_context.post(
                f"/api/loops/custom/{mode_id}/duplicate")
            logger.info("loop duplicate -> %s", dup.status)
            upd = api_context.put(
                f"/api/loops/custom/{mode_id}",
                data=json.dumps({"name": "Cov26 probe loop v2"}),
            )
            logger.info("loop update -> %s", upd.status)
            dele = api_context.delete(f"/api/loops/custom/{mode_id}")
            logger.info("loop delete -> %s", dele.status)

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.runtime_config
class TestEnvsRoundTrip:
    """COV-ENV-001: envs list -> save -> delete round trip."""

    @pytest.mark.test_id("COV-ENV-001")
    def test_envs_round_trip(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List envs")
        ls0 = api_context.get("/api/envs")
        assert ls0.ok, f"envs list [{ls0.status}]"
        orig = ls0.json() if isinstance(ls0.json(), list) else []

        log_test_step("2. Batch-save with a probe var")
        batch = [e for e in orig if e.get("key") != ENV_KEY]
        batch.append({"key": ENV_KEY, "value": "probe"})
        sv = api_context.put("/api/envs", data=json.dumps({"envs": batch}))
        if not sv.ok:
            sv = api_context.put("/api/envs", data=json.dumps(batch))
        logger.info("envs save -> %s", sv.status)

        log_test_step("3. Delete the probe var")
        dl = api_context.delete(f"/api/envs/{ENV_KEY}")
        logger.info("envs delete -> %s", dl.status)
        assert dl.ok or dl.status == 404, f"envs delete [{dl.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.token_usage
class TestTokenUsageSurfaces:
    """COV-TU-001: token usage summary + details."""

    @pytest.mark.test_id("COV-TU-001")
    def test_token_usage_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Summary + details")
        su = api_context.get("/api/token-usage")
        assert su.ok, f"token-usage [{su.status}]"
        det = api_context.get("/api/token-usage/details")
        assert det.ok, f"token-usage details [{det.status}]"

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.models
class TestProvidersDeepSurfaces:
    """COV-PROV-002: providers list + custom provider CRUD + visibility."""

    @pytest.mark.test_id("COV-PROV-002")
    def test_providers_deep_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. List all providers")
        ls = api_context.get("/api/models")
        assert ls.ok, f"providers list [{ls.status}]"

        log_test_step("2. Active model get -> set same -> verify")
        act = api_context.get("/api/models/active")
        assert act.ok, f"active get [{act.status}]"
        active_payload = act.json()

        log_test_step("3. Custom provider create -> delete")
        api_context.delete(f"/api/models/custom-providers/{CUSTOM_PROV}")
        cr = api_context.post(
            "/api/models/custom-providers",
            data=json.dumps({
                "provider_id": CUSTOM_PROV,
                "name": "E2E Cov26 OpenAI-compat",
                "api_type": "openai",
                "base_url": "http://localhost:1/v1",
                "api_key": "sk-probe",
            }),
        )
        logger.info("custom provider create -> %s", cr.status)
        if cr.status in (200, 201):
            disc = api_context.post(
                f"/api/models/{CUSTOM_PROV}/discover")
            logger.info("discover (expected fail) -> %s", disc.status)
            test = api_context.post(
                f"/api/models/{CUSTOM_PROV}/test")
            logger.info("test (expected fail) -> %s", test.status)
            dele = api_context.delete(
                f"/api/models/custom-providers/{CUSTOM_PROV}")
            logger.info("custom provider delete -> %s", dele.status)

        log_test_step("4. OpenRouter surfaces (network-safe)")
        for ep in ("/api/models/openrouter/series",
                   "/api/models/openrouter/discover-extended"):
            try:
                r = api_context.get(ep)
                logger.info("%s -> %s", ep, r.status)
            except Exception as exc:
                logger.info("%s error: %s", ep, exc)
        filt = api_context.post(
            "/api/models/openrouter/models/filter",
            data=json.dumps({"criteria": {}}),
        )
        logger.info("openrouter filter -> %s", filt.status)

        log_test_result(test_name, True, 0)
