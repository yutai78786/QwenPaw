# -*- coding: utf-8 -*-
"""ACS monitoring tracing for QwenPaw (QPQAT, v2.0 §4).

Metadata-only OpenTelemetry tracing built on the agentscope 2.0.6
``middleware._tracing`` lifecycle seam (async-generator-safe span
start/attach/detach/end, exactly-once finalisation).

Privacy contract (§4.1): spans carry ONLY allowlisted metadata —
model family, token counts, duration, error type, tool name, status.
Input/output messages, tool arguments/results and raw exception text
never enter a span; error spans never ``record_exception``.

Everything is off by default (``QPQAT_TRACING_ENABLED=false``),
mirroring the metrics switches.
"""
