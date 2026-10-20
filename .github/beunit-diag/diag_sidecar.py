# -*- coding: utf-8 -*-
"""macOS sidecar startup timing probe (diagnostic only, writes nothing to repo).

Goal: split the >10s managed-service startup observed on macos-latest into
named segments so the root cause can be attributed instead of guessed.

Segments measured, parent side:
  P1 spec built + loopback port allocated
  P2 create_subprocess_exec returned (child forked/exec'd)
  P3 first successful health response  (== what _wait_until_healthy waits on)

Segments measured, child side (written to a jsonl file AND stderr, because
the supervisor keeps the last 30 child lines in _recent_logs):
  C0 child interpreter reached the probe module
  C1 imports finished (json/os/sys/time/http.server)
  C2 socket.getfqdn(host) finished   <-- HTTPServer.server_bind calls this
  C3 HTTPServer constructed (socket bound + listening)
  C4 first GET served

Also measures, in a separate minimal harness (no qwenpaw import in child):
  M1 bare `python -c` interpreter startup to first line printed
  M2 bare HTTPServer bind+serve readiness on loopback

Legs:
  --leg baseline   original startup_timeout=10 (reproduce the failure)
  --leg wide       startup_timeout=<--wide> (candidate fix)
  --leg guard      startup_timeout=<--wide> PLUS artificial child delay
                   < --guard-delay >, which MUST still fail (proves the
                   widened gate still guards; criterion _051)
"""
import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import replace
from pathlib import Path

REPO = Path(os.environ.get("MZ_REPO", "/app/working/git4QwenPaw/QwenPaw/main"))
sys.path.insert(0, str(REPO / "src"))
sys.path.insert(0, str(REPO / "plugins" / "apps" / "qwenpaw-data"))

OUTDIR = Path(os.environ.get("MZ_OUT", "/tmp/mz-sidecar-out"))
OUTDIR.mkdir(parents=True, exist_ok=True)


def p(label, payload):
    line = f"[diag] {label} {json.dumps(payload, ensure_ascii=False)}"
    print(line, flush=True)


PROBE_SRC = textwrap.dedent(
    """\
    import json, os, sys, time
    _C0 = time.time()
    _MARKS = os.environ.get("MZ_MARKS")
    _DELAY = float(os.environ.get("MZ_CHILD_DELAY", "0"))

    def _mark(label, extra=None):
        rec = {"label": label, "rel": round(time.time() - _C0, 4),
               "abs": time.time()}
        if extra:
            rec.update(extra)
        try:
            with open(_MARKS, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec) + "\\n")
        except OSError:
            pass
        sys.stderr.write("[child] " + json.dumps(rec) + "\\n")
        sys.stderr.flush()

    _mark("C0_probe_module_reached", {"pid": os.getpid(),
                                      "argv": sys.argv[1:]})
    if _DELAY > 0:
        _mark("GUARD_delay_begin", {"delay": _DELAY})
        time.sleep(_DELAY)
        _mark("GUARD_delay_end")

    import socket as _socket
    from http.server import BaseHTTPRequestHandler, HTTPServer
    _mark("C1_imports_done")

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"pid": os.getpid(),
                               "secret": os.environ.get("MODEL_SECRET")}).encode()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
            _mark("C4_first_get_served")

        def log_message(self, *args):
            pass

    _host, _port = sys.argv[1], int(sys.argv[2])
    _t = time.time()
    try:
        _fqdn = _socket.getfqdn(_host)
        _err = None
    except Exception as exc:            # pragma: no cover - diagnostic
        _fqdn, _err = None, repr(exc)
    _mark("C2_getfqdn_done", {"fqdn": _fqdn, "err": _err,
                              "took": round(time.time() - _t, 4)})

    _t = time.time()
    _srv = HTTPServer((_host, _port), Handler)
    _mark("C3_httpserver_constructed",
          {"took": round(time.time() - _t, 4),
           "server_name": getattr(_srv, "server_name", None)})
    _srv.serve_forever()
    """
)


async def one_run(leg, startup_timeout, in_process, child_delay):
    from backend import service_compat  # noqa: E402
    from qwenpaw.pawapp import PawApp  # noqa: E402

    tmp = Path(tempfile.mkdtemp(prefix="mz_sidecar_", dir=str(OUTDIR)))
    marks = tmp / "marks.jsonl"
    (tmp / "host modules").mkdir()
    workdir = tmp / "service modules"
    workdir.mkdir()
    (workdir / "lifecycle_probe.py").write_text(PROBE_SRC, encoding="utf-8")

    old_app_data = getattr(service_compat, "APP_DATA_DIR", None)
    service_compat.APP_DATA_DIR = tmp
    os.environ["UNGRANTED_SECRET"] = "host-only"
    os.environ["PYTHONPATH"] = str(tmp / "host modules")
    # NOTE: service_compat grants the child ONLY the _PROCESS_ENV allowlist
    # plus env/env_factory values, so probe settings must ride env_factory --
    # setting them in os.environ alone reaches the child as None (measured).
    probe_env = {"MZ_MARKS": str(marks), "MZ_CHILD_DELAY": str(child_delay)}

    t_wall0 = time.time()
    service = service_compat.managed_service(
        PawApp(),
        "lifecycle",
        command=(
            sys.executable, "-m", "lifecycle_probe",
            "{host}", "{port}", "argument with spaces",
        ),
        cwd=workdir,
        env_factory=lambda: {**probe_env, "MODEL_SECRET": "first"},
        startup_timeout=startup_timeout,
        shutdown_timeout=2,
    )
    if in_process:
        service.spec = replace(
            service.spec,
            command=(
                sys.executable, "-c",
                "import json,runpy,sys; "
                "entry=runpy.run_path(sys.argv[1]); "
                "environment=json.load(open(sys.argv[2], encoding='utf-8')); "
                "entry['run_module'](sys.argv[3:], environment)",
                *service.spec.command[1:],
            ),
        )
    t_spec = time.time() - t_wall0

    result = {"leg": leg, "in_process": in_process,
              "startup_timeout": startup_timeout, "child_delay": child_delay}
    try:
        await service.start()
        t_start = time.time() - t_wall0
        result.update(ok=True, seg_spec_port_s=round(t_spec, 4),
                      seg_start_total_s=round(t_start, 4))
    except BaseException as exc:
        t_start = time.time() - t_wall0
        diag = {}
        try:
            diag = service.diagnostics()
        except Exception:               # pragma: no cover - diagnostic
            pass
        result.update(ok=False, err=repr(exc),
                      seg_spec_port_s=round(t_spec, 4),
                      seg_start_total_s=round(t_start, 4),
                      recent_logs=list(diag.get("recent_logs") or [])[-12:])
    finally:
        try:
            await service.stop()
        except Exception:               # pragma: no cover - diagnostic
            pass
        service_compat.APP_DATA_DIR = old_app_data

    child = []
    if marks.exists():
        for line in marks.read_text(encoding="utf-8").splitlines():
            try:
                child.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    result["child_marks"] = child
    p(f"RESULT_{leg}_{'inproc' if in_process else 'exec'}", result)
    return result


def minimal_harness():
    """Bare interpreter startup + bare HTTPServer readiness, no qwenpaw."""
    t = time.time()
    out = subprocess.run(
        [sys.executable, "-c", "print('hi')"],
        capture_output=True, text=True, timeout=120,
    )
    p("M1_bare_interp_startup_s",
      {"took": round(time.time() - t, 4), "rc": out.returncode,
       "out": out.stdout.strip(), "err": out.stderr.strip()[-200:]})

    code = (
        "import time,socket,sys,json;"
        "from http.server import BaseHTTPRequestHandler,HTTPServer;"
        "t0=time.time();"
        "fq=socket.getfqdn('127.0.0.1');"
        "tfq=time.time();"
        "s=HTTPServer(('127.0.0.1',0),BaseHTTPRequestHandler);"
        "tb=time.time();"
        "print(json.dumps({'fqdn':fq,'fqdn_s':round(tfq-t0,4),"
        "'bind_s':round(tb-tfq,4),'total_s':round(tb-t0,4),"
        "'port':s.server_address[1]}))"
    )
    t = time.time()
    out = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True, text=True, timeout=180,
    )
    p("M2_bare_httpserver", {
        "wall_s": round(time.time() - t, 4), "rc": out.returncode,
        "out": out.stdout.strip(), "err": out.stderr.strip()[-300:],
    })


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--legs", default="baseline,wide,guard")
    ap.add_argument("--wide", type=float, default=90.0)
    ap.add_argument("--guard-delay", type=float, default=120.0)
    ap.add_argument("--skip-minimal", action="store_true")
    args = ap.parse_args()

    p("ENV", {
        "python": sys.version.replace("\n", " "),
        "executable": sys.executable,
        "platform": sys.platform,
        "repo": str(REPO),
        "MZ_REPO_exists": REPO.exists(),
        "cwd": os.getcwd(),
    })
    hosts = Path("/etc/hosts")
    if hosts.exists():
        p("ETC_HOSTS", {"text": hosts.read_text(encoding="utf-8",
                                                errors="replace")[:600]})
    try:
        import socket
        t = time.time()
        fq = socket.getfqdn("127.0.0.1")
        p("PARENT_getfqdn", {"fqdn": fq, "took": round(time.time() - t, 4)})
        t = time.time()
        try:
            by = socket.gethostbyaddr("127.0.0.1")
        except OSError as exc:
            by = f"OSError:{exc}"
        p("PARENT_gethostbyaddr", {"val": str(by),
                                   "took": round(time.time() - t, 4)})
    except Exception as exc:            # pragma: no cover - diagnostic
        p("PARENT_dns_probe_err", {"err": repr(exc)})

    if not args.skip_minimal:
        minimal_harness()

    legs = [x.strip() for x in args.legs.split(",") if x.strip()]
    for leg in legs:
        if leg == "baseline":
            to, delay = 10.0, 0.0
        elif leg == "wide":
            to, delay = args.wide, 0.0
        elif leg == "guard":
            to, delay = args.wide, args.guard_delay
        else:
            continue
        for in_process in (False, True):
            await one_run(leg, to, in_process, delay)


if __name__ == "__main__":
    asyncio.run(main())
