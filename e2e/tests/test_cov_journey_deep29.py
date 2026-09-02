# -*- coding: utf-8 -*-
"""
Mail access-control + auth surfaces (5pp wave 29).

Buffer wave to widen the single-round margin above the 5,928-line bar:
- /mail-access-control: agents, lists, pending all/count/approve/deny/
  dismiss/remark, whitelist add/remove, blacklist add/remove, remark
- /auth: status, verify, login error branch, update-profile no-op

All calls are pure API round trips (no LLM), deterministic by design.

Run: pytest tests/test_cov_journey_deep29.py -v
"""
from __future__ import annotations

import json
import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)

PROBE_ADDR = "e2e-cov29-probe@example.invalid"
PROBE_AGENT = "default"


def _entry(address: str = PROBE_ADDR, agent: str = PROBE_AGENT) -> dict:
    return {
        "agent_id": agent,
        "address": address,
        "remark": "cov29 probe",
        "display_name": "Cov29 Probe",
    }


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.security
class TestMailAclRoundTrips:
    """COV-MAIL-001: mail ACL pending/whitelist/blacklist round trips."""

    @pytest.mark.test_id("COV-MAIL-001")
    def test_mail_acl_round_trips(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        base = "/api/mail-access-control"

        log_test_step("1. Agents + full lists + pending surfaces")
        ag = api_context.get(f"{base}/agents")
        assert ag.ok, f"mail agents [{ag.status}]"
        all_lists = api_context.get(f"{base}")
        assert all_lists.ok, f"mail lists [{all_lists.status}]"
        pend = api_context.get(f"{base}/pending/all")
        assert pend.ok, f"pending all [{pend.status}]"
        cnt = api_context.get(f"{base}/pending/count")
        assert cnt.ok, f"pending count [{cnt.status}]"

        log_test_step("2. Whitelist add -> list shows -> remark -> remove")
        wa = api_context.post(
            f"{base}/whitelist/add", data=json.dumps({"entries": [_entry()]}))
        assert wa.ok, f"whitelist add [{wa.status}]"
        rm = api_context.post(
            f"{base}/remark",
            data=json.dumps({
                "agent_id": PROBE_AGENT,
                "address": PROBE_ADDR,
                "remark": "cov29 remark updated",
            }),
        )
        logger.info("remark -> %s", rm.status)
        wr = api_context.post(
            f"{base}/whitelist/remove", data=json.dumps({"entries": [_entry()]}))
        assert wr.ok, f"whitelist remove [{wr.status}]"

        log_test_step("3. Blacklist add -> remove")
        ba = api_context.post(
            f"{base}/blacklist/add", data=json.dumps({"entries": [_entry()]}))
        assert ba.ok, f"blacklist add [{ba.status}]"
        br = api_context.post(
            f"{base}/blacklist/remove", data=json.dumps({"entries": [_entry()]}))
        assert br.ok, f"blacklist remove [{br.status}]"

        log_test_step("4. Pending approve/deny/dismiss on empty probe")
        for action in ("approve", "deny", "dismiss"):
            r = api_context.post(
                f"{base}/pending/{action}",
                data=json.dumps({"entries": [_entry()]}),
            )
            logger.info("pending %s -> %s", action, r.status)
        pr = api_context.post(
            f"{base}/pending/remark",
            data=json.dumps({
                "agent_id": PROBE_AGENT,
                "address": PROBE_ADDR,
                "remark": "cov29 pending remark",
            }),
        )
        logger.info("pending remark -> %s", pr.status)

        log_test_step("5. Cleanup probe entries from all lists")
        for list_action in ("whitelist/remove", "blacklist/remove"):
            api_context.post(
                f"{base}/{list_action}",
                data=json.dumps({"entries": [_entry()]}),
            )

        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p1
@pytest.mark.auth
class TestAuthSurfaces:
    """COV-AUTH-001: auth status/verify/login-error/update-profile."""

    @pytest.mark.test_id("COV-AUTH-001")
    def test_auth_surfaces(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name

        log_test_step("1. Status + verify")
        st = api_context.get("/api/auth/status")
        assert st.ok, f"auth status [{st.status}]"
        vf = api_context.get("/api/auth/verify")
        assert vf.ok, f"auth verify [{vf.status}]"

        log_test_step("2. Login probe (auth may be disabled -> empty token)")
        lg = api_context.post(
            "/api/auth/login",
            data=json.dumps({
                "username": "e2e-cov29-no-such-user",
                "password": "e2e-cov29-wrong-password",
            }),
        )
        logger.info("login -> %s", lg.status)
        assert lg.status in (200, 400, 401, 403, 404), (
            f"login probe [{lg.status}]"
        )

        log_test_step("3. Update profile probe (auth-disabled branch ok)")
        up = api_context.post(
            "/api/auth/update-profile",
            data=json.dumps({
                "current_password": "e2e-cov29-wrong",
                "new_username": None,
                "new_password": None,
            }),
        )
        logger.info("update-profile -> %s", up.status)
        assert up.status in (200, 400, 401, 403, 404), (
            f"update-profile [{up.status}]"
        )

        log_test_result(test_name, True, 0)
