#!/usr/bin/env python3
"""Test abox-init + abox-exec on Modal runtime.

Injects latest local files into the GHCR image via add_local_file,
boots a sandbox, waits for services, and checks structured JSON output.
"""
import asyncio
import os
import time

import modal

# Resolve paths relative to this script, not cwd
_REPO = os.path.dirname(os.path.abspath(__file__))

GHCR_IMAGE = "ghcr.io/veyorokon/agentobox-agent-claude:dev"
AGENT_DIR = os.path.join(_REPO, "agent")

# Files to inject (local path → container path)
def _f(rel):
    return os.path.join(AGENT_DIR, rel)

INJECT_FILES = {
    _f("rootfs/usr/local/bin/abox-init"): "/usr/local/bin/abox-init",
    _f("rootfs/usr/local/bin/abox-exec"): "/usr/local/bin/abox-exec",
    _f("rootfs/opt/abox/abox_logging.py"): "/opt/abox/abox_logging.py",
    _f("rootfs/opt/abox/preflight.py"): "/opt/abox/preflight.py",
    _f("rootfs/etc/s6-overlay/scripts/preflight"): "/etc/s6-overlay/scripts/preflight",
    # run scripts
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-relay/run"): "/etc/s6-overlay/s6-rc.d/svc-relay/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-apiproxy/run"): "/etc/s6-overlay/s6-rc.d/svc-apiproxy/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-mcp-gateway/run"): "/etc/s6-overlay/s6-rc.d/svc-mcp-gateway/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-awesome/run"): "/etc/s6-overlay/s6-rc.d/svc-awesome/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-xvfb/run"): "/etc/s6-overlay/s6-rc.d/svc-xvfb/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-x11vnc/run"): "/etc/s6-overlay/s6-rc.d/svc-x11vnc/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-websockify/run"): "/etc/s6-overlay/s6-rc.d/svc-websockify/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-dbus/run"): "/etc/s6-overlay/s6-rc.d/svc-dbus/run",
    _f("rootfs/etc/s6-overlay/s6-rc.d/svc-relay-http/run"): "/etc/s6-overlay/s6-rc.d/svc-relay-http/run",
}


async def main():
    print("=== Modal boot test ===")
    print(f"Base image: {GHCR_IMAGE}")

    # Build image with local file overrides
    image = modal.Image.from_registry(
        GHCR_IMAGE,
        secret=modal.Secret.from_name("ghcr-secret"),
    )
    for local, remote in INJECT_FILES.items():
        image = image.add_local_file(local, remote, copy=True)

    # Make injected scripts executable
    svc_run_paths = " ".join(
        remote for remote in INJECT_FILES.values()
        if remote.endswith("/run")
    )
    image = image.run_commands(
        f"chmod +x /usr/local/bin/abox-init /usr/local/bin/abox-exec "
        f"/etc/s6-overlay/scripts/preflight {svc_run_paths}"
    ).entrypoint(["/usr/local/bin/abox-init"])

    app = await modal.App.lookup.aio("agentobox", create_if_missing=True)

    env = {
        "DISPLAY": ":1",
        "RESOLUTION": "1920x1080",
        "AGENT_ID": "modal-boot-test",
        "ABOX_ENVIRONMENT": "test",
    }

    print("Creating sandbox...")
    t0 = time.monotonic()
    with modal.enable_output():
        sb = await modal.Sandbox.create.aio(
            app=app,
            image=image,
            secrets=[modal.Secret.from_dict(env)],
            encrypted_ports=[6080, 8080],
            timeout=120,
            cpu=2.0,
            memory=4096,
        )
    print(f"Sandbox created: {sb.object_id} ({time.monotonic() - t0:.1f}s)")

    # Wait for services to boot (xvfb + x11vnc + websockify need ~10s)
    print("Waiting 20s for services to boot...")
    await asyncio.sleep(20)

    # Verify sandbox is still alive
    result = await sb.poll.aio()
    if result is not None:
        print(f"FAIL: Sandbox exited early with code {result}")
        # Read whatever logs are available
        try:
            stderr = await sb.stderr.read.aio()
            print(f"\n=== Sandbox stderr ===\n{stderr[-2000:]}")
        except Exception:
            pass
        return

    print("Sandbox is alive after 20s — running health checks\n")

    # --- Health checks (sandbox is running) ---

    # 1. Process list
    proc = await sb.exec.aio("ps", "aux")
    await proc.wait.aio()
    ps_output = await proc.stdout.read.aio()
    print(f"=== Process list ===\n{ps_output}")

    # 2. PID 1
    proc = await sb.exec.aio("cat", "/proc/1/cmdline")
    await proc.wait.aio()
    pid1 = await proc.stdout.read.aio()
    print(f"PID 1: {pid1.replace(chr(0), ' ').strip()}")

    # 3. Tunnel URLs
    tunnels = await sb.tunnels.aio()
    health_url = tunnels.get(8080)
    vnc_url = tunnels.get(6080)
    print(f"VNC tunnel: {vnc_url.url if vnc_url else 'MISSING'}")
    print(f"Health tunnel: {health_url.url if health_url else 'MISSING'}")

    # 4. VNC check — hit the noVNC web root via tunnel
    if vnc_url:
        proc = await sb.exec.aio("bash", "-c", "curl -s -o /dev/null -w '%{http_code}' http://localhost:6080/")
        await proc.wait.aio()
        vnc_status = (await proc.stdout.read.aio()).strip()
        print(f"VNC HTTP status: {vnc_status} (expected: 200)")

    # 5. x11vnc listening check
    proc = await sb.exec.aio("bash", "-c", "ss -tlnp | grep 5900 || echo 'NOT LISTENING'")
    await proc.wait.aio()
    vnc_listen = (await proc.stdout.read.aio()).strip()
    print(f"x11vnc port 5900: {vnc_listen}")

    # 6. Xvfb display check
    proc = await sb.exec.aio("bash", "-c", "xdpyinfo -display :1 2>/dev/null | head -3 || echo 'DISPLAY NOT AVAILABLE'")
    await proc.wait.aio()
    display_info = (await proc.stdout.read.aio()).strip()
    print(f"Xvfb display :1: {display_info}")

    # 7. Preflight failure count (expected: 3 — relay, apiproxy, mcp-gateway)
    proc = await sb.exec.aio("bash", "-c",
        "grep -c preflight_failed /proc/*/fd/1 2>/dev/null || "
        "cat /run/uncaught-logs/current 2>/dev/null | grep -c preflight_failed || echo 0")
    await proc.wait.aio()
    preflight_count = (await proc.stdout.read.aio()).strip()
    print(f"Preflight failures: {preflight_count} (expected: 3)")

    # 8. s6 service status
    proc = await sb.exec.aio("bash", "-c", "ls /run/abox-services/*/supervise/status 2>/dev/null | wc -l")
    await proc.wait.aio()
    supervised = (await proc.stdout.read.aio()).strip()
    print(f"Supervised services: {supervised} (expected: 9)")

    # 9. Check which services are up vs sleeping
    proc = await sb.exec.aio("bash", "-c",
        "for svc in /run/abox-services/svc-*/; do "
        "  name=$(basename $svc); "
        "  pid=$(cat $svc/supervise/pid 2>/dev/null); "
        "  if [ -n \"$pid\" ] && [ \"$pid\" != \"0\" ]; then "
        "    cmd=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\\0' ' '); "
        "    echo \"  $name: UP (pid=$pid) $cmd\"; "
        "  else "
        "    echo \"  $name: DOWN\"; "
        "  fi; "
        "done")
    await proc.wait.aio()
    svc_status = (await proc.stdout.read.aio()).strip()
    print(f"\n=== Service status ===\n{svc_status}")

    # --- Done, terminate ---
    print("\nTerminating sandbox...")
    await sb.terminate.aio()
    elapsed = time.monotonic() - t0
    print(f"Done in {elapsed:.1f}s")


if __name__ == "__main__":
    asyncio.run(main())
