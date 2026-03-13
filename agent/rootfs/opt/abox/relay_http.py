"""HTTP health/status surface for agent containers.

Intentionally separate from the relay process. The relay manages a
bidirectional WS bridge with complex lifecycle (SDK subprocess, event
buffering, restart/clear state machine). Merging HTTP into that would
mean a relay crash takes down health checks -- the one thing you need
working when everything else is broken. Separate s6 services means
independent failure modes: relay dies, /readyz returns 503, s6 and
Modal health probes see it immediately.

Communication is via filesystem only -- the relay writes state to a
JSON file, this server reads it. No shared memory, no imports, no
coupling. Both are independently restartable by s6.

Endpoints:
    GET /livez   -- process alive (always 200)
    GET /readyz  -- relay connected to backend WS (200 if connected, 503 if not)
    GET /healthz -- alias for /readyz (k8s convention)
    GET /status  -- full relay state snapshot (JSON)
"""
from pathlib import Path
import json
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse

STATE_PATH = Path("/tmp/relay-state.json")

# State file older than this (seconds) is considered stale.
# Relay writes every 60s via _periodic_buffer_stats, so 2x gives margin.
STALE_THRESHOLD_S = 120

app = FastAPI(docs_url=None, redoc_url=None)


def _read_state() -> tuple[dict | None, bool]:
    """Read state file. Returns (state_dict, is_stale)."""
    try:
        state = json.loads(STATE_PATH.read_text())
        age = time.time() - STATE_PATH.stat().st_mtime
        return state, age > STALE_THRESHOLD_S
    except (FileNotFoundError, json.JSONDecodeError):
        return None, True


@app.get("/livez")
async def livez():
    return {"status": "ok"}


@app.get("/readyz")
async def readyz():
    state, stale = _read_state()
    if stale:
        return JSONResponse({"status": "not_ready", "reason": "stale", **(state or {})}, status_code=503)
    if state and state.get("ws_connected"):
        return {"status": "ready", **state}
    return JSONResponse({"status": "not_ready", **(state or {})}, status_code=503)


@app.get("/healthz")
async def healthz():
    return await readyz()


@app.get("/status")
async def status():
    state, stale = _read_state()
    if state:
        if stale:
            state["_stale"] = True
        return state
    return JSONResponse({"error": "no state available"}, status_code=503)
