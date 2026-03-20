from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path

import pytest

modal = pytest.importorskip("modal")


pytestmark = [pytest.mark.contract]


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        pytest.skip(f"{name} is required for managed Modal contract tests")
    return value


async def _write_text(sb, path: str, content: str) -> None:
    handle = await sb.open.aio(path, "w")
    handle.write(content)
    handle.close()


async def _exec_checked(sb, *cmd: str) -> str:
    proc = await sb.exec.aio(*cmd)
    await proc.wait.aio()
    stdout = await proc.stdout.read.aio()
    if proc.returncode != 0:
        stderr = ""
        try:
            stderr = await proc.stderr.read.aio()
        except Exception:
            pass
        raise AssertionError(
            f"modal exec failed rc={proc.returncode}: {' '.join(cmd)}\nstdout:\n{stdout}\nstderr:\n{stderr}"
        )
    return stdout


async def _http_get_json(sb, path: str) -> dict:
    code = await _exec_checked(
        sb,
        "python",
        "-c",
        (
            "import json,urllib.request;"
            f"resp=urllib.request.urlopen('http://127.0.0.1:8080{path}', timeout=5);"
            "print(json.dumps(json.load(resp)))"
        ),
    )
    return json.loads(code)


@pytest.mark.skipif(
    os.environ.get("AGENTOBOX_RUN_MODAL_CONTRACT_TESTS") != "1",
    reason="set AGENTOBOX_RUN_MODAL_CONTRACT_TESTS=1 to run Modal managed contract tests",
)
def test_managed_modal_contract_boots_runtime_and_serves_health():
    asyncio.run(_managed_modal_contract_boots_runtime_and_serves_health())


async def _managed_modal_contract_boots_runtime_and_serves_health():
    image_ref = _env("AGENTOBOX_MODAL_CONTRACT_IMAGE")

    app = await modal.App.lookup.aio("agentobox", create_if_missing=True)

    agent_id = f"modal-contract-{uuid.uuid4().hex[:8]}"
    relay_token = f"token-{uuid.uuid4().hex}"
    root_dir = f"/tmp/agentobox-contract/{agent_id}"
    callback_url = os.environ.get("AGENTOBOX_MODAL_CONTRACT_CALLBACK_URL", "https://example.com/graphql")

    env = {
        "AGENTOBOX_MODE": "managed",
        "AGENTOBOX_PLATFORM": "modal",
        "AGENTOBOX_RUNTIME_PROFILE": "desktop",
        "AGENTOBOX_EXECUTOR": "echo",
        "AGENTOBOX_BIND_HOST": "0.0.0.0",
        "AGENTOBOX_PORT": "8080",
        "AGENTOBOX_ROOT_DIR": root_dir,
        "AGENT_HOME": "/home/agent",
        "AGENT_ID": agent_id,
        "ABOX_CALLBACK_URL": callback_url,
        "RELAY_AUTH_TOKEN": relay_token,
        "DISPLAY": ":99",
        "RESOLUTION": "1920x1080",
    }

    image = modal.Image.from_registry(
        image_ref,
        secret=modal.Secret.from_name("ghcr-secret"),
    )

    sb = None
    try:
        sb = await modal.Sandbox.create.aio(
            app=app,
            image=image,
            secrets=[modal.Secret.from_dict(env)],
            encrypted_ports=[6080, 8080],
            timeout=300,
            cpu=2.0,
            memory=4096,
        )

        await _exec_checked(
            sb,
            "bash",
            "-lc",
            (
                f"mkdir -p {root_dir}/home/agent {root_dir}/_abox "
                f"{root_dir}/tmp/abox-theme {root_dir}/mnt/abox-state/secrets"
            ),
        )
        await _write_text(sb, f"{root_dir}/home/agent/.relay_env", f"RELAY_AUTH_TOKEN={relay_token}\n")
        await _write_text(sb, f"{root_dir}/_abox/state.json", "{}")
        await _write_text(sb, f"{root_dir}/_abox/status.json", "{}")
        await _write_text(sb, f"{root_dir}/_abox/provisioned.ready", relay_token)

        await _exec_checked(sb, "bash", "-lc", f"chown -R agent:agent {root_dir}")

        deadline = time.monotonic() + 60
        last_error = ""
        while time.monotonic() < deadline:
            result = await sb.poll.aio()
            if result is not None:
                stderr = ""
                try:
                    stderr = await sb.stderr.read.aio()
                except Exception:
                    pass
                raise AssertionError(
                    f"managed modal contract sandbox exited early rc={result}\nstderr:\n{stderr[-4000:]}"
                )
            try:
                livez = await _http_get_json(sb, "/livez")
                status = await _http_get_json(sb, "/status")
                assert livez == {"status": "ok"}
                assert status["mode"] == "managed"
                assert status["platform"] == "modal"
                assert status["profile"] == "desktop"
                log_path = Path(root_dir) / "_abox" / "logs" / "runtime.jsonl"
                runtime_log = await _exec_checked(sb, "bash", "-lc", f"cat {log_path} 2>/dev/null || true")
                assert "runtime.booting" in runtime_log
                assert "transport_connecting" in runtime_log or "transport_degraded" in runtime_log
                return
            except Exception as exc:
                last_error = str(exc)
                await asyncio.sleep(2)

        raise AssertionError(f"managed modal contract did not become healthy in time: {last_error}")
    finally:
        if sb is not None:
            await sb.terminate.aio()
