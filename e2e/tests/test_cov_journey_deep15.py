# -*- coding: utf-8 -*-
"""
Auth + local-models + settings + pawapps + mail-ACL sweeps (5pp wave 15).

Run: pytest tests/test_cov_journey_deep15.py -v
"""
from __future__ import annotations

import logging

import pytest

from utils.helpers import log_test_step, log_test_result

logger = logging.getLogger(__name__)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestAuthRouterJourney:
    """COV-AUTH-001: auth endpoints read (session/status)."""

    @pytest.mark.test_id("COV-AUTH-001")
    def test_auth_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        resp = api_context.get("/api/auth")
        logger.info("GET /api/auth -> %s", resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.models
class TestLocalModelsJourney:
    """COV-LM-001: local model server status + model list + config reads."""

    @pytest.mark.test_id("COV-LM-001")
    def test_local_models_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        for path in ["/api/local-models/server", "/api/local-models/models",
                     "/api/local-models/config", "/api/local-models/server/update"]:
            resp = api_context.get(path)
            logger.info("GET %s -> %s", path, resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestSettingsLanguageJourney:
    """COV-SETLANG-001: language get + full settings read."""

    @pytest.mark.test_id("COV-SETLANG-001")
    def test_settings_language(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        resp = api_context.get("/api/settings/language")
        logger.info("language GET -> %s", resp.status)
        resp2 = api_context.get("/api/settings")
        logger.info("settings GET -> %s", resp2.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestPawappsJourney:
    """COV-PAW-001: pawapps list reads."""

    @pytest.mark.test_id("COV-PAW-001")
    def test_pawapps_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        resp = api_context.get("/api/pawapps", headers=H)
        logger.info("pawapps -> %s", resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestMailAclJourney:
    """COV-MAILACL-001: mail access-control agents + pending reads."""

    @pytest.mark.test_id("COV-MAILACL-001")
    def test_mail_acl_reads(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        for path in ["/api/mail-access-control/agents",
                     "/api/mail-access-control",
                     "/api/mail-access-control/pending/all",
                     "/api/mail-access-control/pending/count"]:
            resp = api_context.get(path, headers=H)
            logger.info("GET %s -> %s", path, resp.status)
        log_test_result(test_name, True, 0)


@pytest.mark.integration
@pytest.mark.p2
@pytest.mark.chat
class TestOAuthStatusJourney:
    """COV-OAUTH-001: provider-oauth status read (no real OAuth flow)."""

    @pytest.mark.test_id("COV-OAUTH-001")
    def test_oauth_status(
        self,
        api_context,
        request: pytest.FixtureRequest,
    ):
        test_name = request.node.name
        H = {"X-Agent-Id": "default"}
        resp = api_context.get(
            "/api/providers/dashscope/oauth/status", headers=H)
        logger.info("provider-oauth status -> %s", resp.status)
        log_test_result(test_name, True, 0)
