# -*- coding: utf-8 -*-
"""Desktop screenshot tool must not block the event loop (GH#7363).

GH#7363 reported that a synchronous desktop capture stalled the request
pipeline for 118-135 seconds because the blocking call ran directly on the
event loop instead of a worker thread.  The fix routes the capture through
``run_sync_io`` (``agents/tools/desktop_screenshot.py:201``) so the loop
stays responsive.

These cases drive the *real* ``desktop_screenshot`` tool inside the app
subprocess: the mock LLM is forced to emit a tool call, so the genuine tool
implementation runs.  CI runners have no display server, so ``_capture_mss``
fails and ``_tool_error`` returns a structured error -- that is the branch
under test (graceful degradation, no hang, no 500).

API endpoints:
    - POST /api/console/chat/task        (drives a full agent turn)
    - GET  /api/console/chat/task/{id}   (poll to completion)
    - GET  /api/healthz                  (lightweight liveness probe)
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

# GH#7363 regression budgets.  The defect stalled the turn for 118-135s, so
# the turn budget must sit BELOW that range or the assertion can never fail
# for the regression it claims to catch.  A healthy capture attempt (including
# the headless no-display fast-fail) completes in a few seconds; 60s leaves
# ample headroom for slow CI runners while staying under the defect window.
_TURN_BUDGET_SECONDS = 60.0

# The actual GH#7363 contract: the blocking capture must not occupy the event
# loop, so a trivial liveness probe issued during a capture stays fast.
_LOOP_BUDGET_SECONDS = 10.0


@pytest.fixture(scope="module")
def mock_llm():
    """Module-scoped mock OpenAI server with tool_call support."""
    srv = HTTPServer(("127.0.0.1", 0), MockLLMHandler)
    srv.force_error = False
    srv.force_tool_call = False
    port = srv.server_address[1]
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield srv, f"http://127.0.0.1:{port}/v1"
    srv.shutdown()


def _submit_chat_task(app_server, user_id: str, text: str) -> str:
    """Submit one console chat task; return its task_id."""
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
    return submit.json()["task_id"]


def _wait_task_finished(app_server, task_id: str, budget: float):
    """Poll GET /console/chat/task/{id} until status=='finished'."""
    deadline = time.time() + budget
    while time.time() < deadline:
        poll = app_server.api_request(
            "GET",
            f"/api/console/chat/task/{task_id}",
            timeout=default_http_timeout(15.0),
        )
        assert poll.status_code == 200, app_server.logs_tail()[-2000:]
        body = poll.json()
        if body.get("status") == "finished":
            return body
        time.sleep(0.4)
    raise AssertionError(
        f"chat task {task_id} did not finish within {budget:.0f}s: "
        + app_server.logs_tail()[-2000:],
    )


def _drive_screenshot(
    app_server,
    srv,
    mock_url,
    user_id: str,
    args: str = "{}",
):
    """Force one real desktop_screenshot tool call.

    Returns the final task payload once the turn reaches 'finished'.
    """
    srv.force_tool_call = True
    srv.tool_call_name = "desktop_screenshot"
    srv.tool_call_arguments = args
    unregister_mock_provider(app_server, MOCK_LLM_PROVIDER_ID)
    provider_id = register_mock_provider(app_server, mock_url)
    try:
        task_id = _submit_chat_task(app_server, user_id, "capture my desktop")
        return _wait_task_finished(app_server, task_id, budget=180.0)
    finally:
        srv.force_tool_call = False
        unregister_mock_provider(app_server, provider_id)


@pytest.mark.integration
@pytest.mark.p0
class TestDesktopScreenshotDoesNotBlockLoop:
    """The GH#7363 defect was a blocked event loop, so these cases probe it."""

    def test_screenshot_turn_completes_without_stalling(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """A real desktop_screenshot call finishes well inside the budget.

        Test purpose:
            - Run the genuine tool through a full agent turn.  Before the
              fix this call hung for 118-135s; it must now return quickly.

        Test flow:
            1. Force the mock LLM to call desktop_screenshot.
            2. Assert the turn reaches 'finished' inside the GH#7363 budget.
        """
        srv, mock_url = mock_llm
        started = time.monotonic()
        body = _drive_screenshot(
            app_server,
            srv,
            mock_url,
            "integ-desktop-timeout-01",
        )
        elapsed = time.monotonic() - started

        # Threshold must sit BELOW the defect's own 118-135s stall, otherwise
        # the assertion cannot fail for the very regression it claims to catch.
        assert elapsed < _TURN_BUDGET_SECONDS, (
            f"turn took {elapsed:.1f}s, over the {_TURN_BUDGET_SECONDS:.0f}s "
            f"budget; GH#7363 stalled at 118-135s. logs: "
            f"{app_server.logs_tail()[-1500:]}"
        )
        assert body.get("status") == "finished", body

    def test_event_loop_stays_responsive_during_capture(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """Concurrent liveness probes stay fast while a capture is running.

        Test purpose:
            - This is the actual GH#7363 contract: the blocking capture must
              run off the loop.  If it ran on the loop, a trivial probe issued
              during the capture would queue behind it.

        Test flow:
            1. On a worker thread, drive desktop_screenshot turns back to back
               until a stop flag is set.  A single turn is not enough: on a
               headless runner the capture fast-fails in under a second, so
               one turn could finish before the first probe and the case would
               then measure an idle server (and fail for the wrong reason).
            2. Probe GET /api/healthz from the main thread across that window.
            3. Assert at least one turn really completed during the window
               (overlap proven) and every probe stayed inside the budget.
        """
        srv, mock_url = mock_llm
        stop = threading.Event()
        completed: list[str] = []
        errors: list[BaseException] = []

        def drive_until_stopped() -> None:
            """Keep running screenshot turns so the loop is never idle."""
            attempt = 0
            while not stop.is_set():
                attempt += 1
                try:
                    body = _drive_screenshot(
                        app_server,
                        srv,
                        mock_url,
                        f"integ-desktop-timeout-02-{attempt}",
                    )
                    completed.append(body.get("status", "?"))
                except BaseException as exc:  # noqa: BLE001 - surfaced below
                    errors.append(exc)
                    return

        # NOTE: no provider registration here -- _drive_screenshot
        # registers and unregisters on the worker thread, and a second
        # outer registration would race with it.  The probes below only
        # hit /api/healthz, which is independent of provider config.
        worker = threading.Thread(target=drive_until_stopped, daemon=True)
        worker.start()

        try:
            slowest_probe = 0.0
            for attempt in range(6):
                started = time.monotonic()
                probe = app_server.api_request(
                    "GET",
                    "/api/healthz",
                    timeout=_LOOP_BUDGET_SECONDS,
                )
                probe_elapsed = time.monotonic() - started
                slowest_probe = max(slowest_probe, probe_elapsed)

                assert probe_elapsed < _LOOP_BUDGET_SECONDS, (
                    f"probe #{attempt} took {probe_elapsed:.1f}s while "
                    "desktop_screenshot turns were being driven; the event "
                    f"loop is blocked (GH#7363 regression). completed turns: "
                    f"{len(completed)}, worker errors: {errors[:1]}"
                )
                # The app_server fixture only yields after /api/healthz answers
                # 200 with {"status": "ok"} (conftest.py:495-509), so readiness
                # is guaranteed here -- assert it exactly rather than allowing
                # a range that would also pass on a foreign 503.
                assert probe.status_code == 200, (
                    f"/api/healthz returned {probe.status_code} while a "
                    "desktop_screenshot was in flight"
                )
                assert (
                    probe.json().get("status") == "ok"
                ), "healthz answered but did not identify as the real app"
                time.sleep(0.25)  # spread the probes across the capture window
        finally:
            stop.set()
            worker.join(timeout=240)

        # Overlap proof: at least one real screenshot turn completed while the
        # probes were running.  Without this the timing assertion above could
        # pass against an idle server and prove nothing.
        assert not errors, f"worker turn raised: {errors[0]!r}"
        assert len(completed) >= 1, (
            "no desktop_screenshot turn completed during the probe window, so "
            f"the probes measured an idle server. slowest probe: "
            f"{slowest_probe:.2f}s, logs: {app_server.logs_tail()[-1500:]}"
        )
        assert all(
            status == "finished" for status in completed
        ), f"a screenshot turn did not finish cleanly: {completed}"

    def test_no_display_degrades_to_structured_error(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """Without a display server the tool reports an error, not a crash.

        Test purpose:
            - ``_capture_mss`` wraps every failure in ``except Exception`` and
              returns ``_tool_error`` (desktop_screenshot.py:85-87), so a
              headless runner must still see a finished turn whose tool result
              mentions the capture.

        Test flow:
            1. Drive one real desktop_screenshot call.
            2. Assert the turn finished and the surfaced tool result talks
               about the screenshot (success text or the mss failure text).
        """
        srv, mock_url = mock_llm
        body = _drive_screenshot(
            app_server,
            srv,
            mock_url,
            "integ-desktop-timeout-03",
        )
        payload = json.dumps(body, ensure_ascii=False)

        assert body.get("status") == "finished", body
        assert "creenshot" in payload or "mss" in payload, (
            "the desktop_screenshot tool result never surfaced in the turn "
            f"payload; the forced tool call did not run. logs: "
            f"{app_server.logs_tail()[-1500:]}"
        )

    def test_explicit_path_argument_is_passed_through(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """The tool's own ``path`` argument reaches the implementation.

        Test purpose:
            - ``desktop_screenshot`` normalises ``path``: a relative value is
              resolved against the tool base dir and a missing ``.png`` suffix
              is appended (desktop_screenshot.py:186-189).  Passing a bare
              name exercises that branch through the real call path.

        Test flow:
            1. Force the tool call with {"path": "integ_probe.png"}.
            2. Assert the turn still finishes (the argument is accepted and
               the normalisation branch does not raise).
        """
        srv, mock_url = mock_llm
        body = _drive_screenshot(
            app_server,
            srv,
            mock_url,
            "integ-desktop-timeout-04",
            json.dumps({"path": "integ_probe.png"}),
        )
        assert body.get("status") == "finished", body

    def test_capture_window_flag_is_tolerated_on_linux(
        self,
        app_server,
        mock_llm,  # pylint: disable=redefined-outer-name
    ):
        """capture_window=True must not break non-macOS platforms.

        Test purpose:
            - ``capture_window`` is only honoured on Darwin with an interactive
              window picker (desktop_screenshot.py:194-199); on Linux and
              Windows it is documented as ignored.  A CI runner passing it
              must still get a finished turn rather than a hang or a crash.

        Test flow:
            1. Force the tool call with {"capture_window": true}.
            2. Assert the turn finishes inside the regression budget.
        """
        srv, mock_url = mock_llm
        started = time.monotonic()
        body = _drive_screenshot(
            app_server,
            srv,
            mock_url,
            "integ-desktop-timeout-05",
            json.dumps({"capture_window": True}),
        )
        elapsed = time.monotonic() - started

        assert body.get("status") == "finished", body
        assert elapsed < _TURN_BUDGET_SECONDS, (
            f"turn took {elapsed:.1f}s with capture_window=True; the "
            "interactive-picker branch may have leaked onto Linux"
        )
