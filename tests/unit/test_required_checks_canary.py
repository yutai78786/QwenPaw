# -*- coding: utf-8 -*-
"""Canary test that fails on purpose (required-checks verification)."""
import pytest


@pytest.mark.unit
def test_required_checks_canary_fails() -> None:
    assert False, "intentional failure: verifying required status checks"
