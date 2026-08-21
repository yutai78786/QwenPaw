# -*- coding: utf-8 -*-
"""ACS monitoring metrics for QwenPaw (QPQAT).

Metrics exposition is served by a dedicated asyncio server on port
9090 (:mod:`qwenpaw.observability.metrics.server`), fully separate from
the business API on 8088. Everything is off by default
(``QPQAT_METRICS_ENABLED=false``).

Contract: ACS monitoring v2.0 §2 (metrics schema), §2.2 (allowlists),
§3 (run observer), §5.1 (metrics server).
"""
