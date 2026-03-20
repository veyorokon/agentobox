from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import modal


DEFAULT_CALLBACK_URL = "https://example.com/graphql"


class ModalHarnessError(RuntimeError):
    """Raised when the managed Modal harness cannot prove the runtime contract."""


@dataclass(frozen=True)
class ModalHarnessResult:
    sandbox_id: str
    image_ref: str
    root_dir: str
    vnc_url: str
    health_url: str
    status_payload: dict[str, Any]
    runtime_log_tail: str


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ModalHarnessError(f"{name} is required")
    return value


async def write_text(sb, path: str, content: str) -> None:
    handle = await sb.open.aio(path, "w")
    handle.write(content)
    handle.close()


async def exec_checked(sb, *cmd: str) -> str:
    proc = await sb.exec.aio(*cmd)
    await proc.wait.aio()
    stdout = await proc.stdout.read.aio()
    if proc.returncode != 0:
        stderr = ""
        try:
            stderr = await proc.stderr.read.aio()
        except Exception:
            pass
        raise ModalHarnessError(
            f"modal exec failed rc={proc.returncode}: {' '.join(cmd)}\nstdout:\n{stdout}\nstderr:\n{stderr}"
        )
    return stdout


async def http_get_json(sb, path: str) -> dict[str, Any]:
    payload = await exec_checked(
        sb,
        "python",
        "-c",
        (
            "import json,urllib.request;"
            f"resp=urllib.request.urlopen('http://127.0.0.1:8080{path}', timeout=5);"
            "print(json.dumps(json.load(resp)))"
        ),
    )
    return json.loads(payload)


async def runtime_log_tail(sb, root_dir: str, *, lines: int = 80) -> str:
    log_path = Path(root_dir) / "_abox" / "logs" / "runtime.jsonl"
    return await exec_checked(sb, "bash", "-lc", f"tail -n {lines} {log_path} 2>/dev/null || true")


async def provision_minimal_managed_root(sb, *, root_dir: str, relay_token: str) -> None:
    await exec_checked(
        sb,
        "bash",
        "-lc",
        (
            f"mkdir -p {root_dir}/home/agent {root_dir}/_abox "
            f"{root_dir}/tmp/abox-theme {root_dir}/mnt/abox-state/secrets"
        ),
    )
    await write_text(sb, f"{root_dir}/home/agent/.relay_env", f"RELAY_AUTH_TOKEN={relay_token}\n")
    await write_text(sb, f"{root_dir}/_abox/state.json", "{}")
    await write_text(sb, f"{root_dir}/_abox/status.json", "{}")
    await write_text(sb, f"{root_dir}/_abox/provisioned.ready", relay_token)
    await exec_checked(sb, "bash", "-lc", f"chown -R agent:agent {root_dir}")


async def run_managed_modal_contract(
    *,
    image_ref: str,
    callback_url: str = DEFAULT_CALLBACK_URL,
    keep_alive: bool = False,
    timeout_s: float = 60.0,
    app_name: str = "agentobox",
    root_dir_base: str = "/tmp/agentobox-contract",
) -> ModalHarnessResult:
    app = await modal.App.lookup.aio(app_name, create_if_missing=True)

    agent_id = f"modal-contract-{uuid.uuid4().hex[:8]}"
    relay_token = f"token-{uuid.uuid4().hex}"
    root_dir = f"{root_dir_base.rstrip('/')}/{agent_id}"

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

        await provision_minimal_managed_root(sb, root_dir=root_dir, relay_token=relay_token)

        deadline = time.monotonic() + timeout_s
        last_error = ""
        last_status: dict[str, Any] = {}
        while time.monotonic() < deadline:
            result = await sb.poll.aio()
            if result is not None:
                stderr = ""
                try:
                    stderr = await sb.stderr.read.aio()
                except Exception:
                    pass
                raise ModalHarnessError(
                    f"managed modal contract sandbox exited early rc={result}\nsandbox_id={sb.object_id}\nstderr:\n{stderr[-4000:]}"
                )
            try:
                livez = await http_get_json(sb, "/livez")
                status = await http_get_json(sb, "/status")
                last_status = status
                if livez != {"status": "ok"}:
                    raise ModalHarnessError(f"unexpected livez payload: {livez}")
                if status["mode"] != "managed":
                    raise ModalHarnessError(f"unexpected mode: {status['mode']}")
                if status["platform"] != "modal":
                    raise ModalHarnessError(f"unexpected platform: {status['platform']}")
                if status["profile"] != "desktop":
                    raise ModalHarnessError(f"unexpected profile: {status['profile']}")

                log_tail = await runtime_log_tail(sb, root_dir)
                if "runtime.booting" not in log_tail:
                    raise ModalHarnessError("runtime log does not include runtime.booting")
                if "transport_connecting" not in log_tail and "transport_degraded" not in log_tail:
                    raise ModalHarnessError("runtime log does not show transport activity")

                tunnels = await sb.tunnels.aio()
                result = ModalHarnessResult(
                    sandbox_id=sb.object_id,
                    image_ref=image_ref,
                    root_dir=root_dir,
                    vnc_url=tunnels[6080].url if 6080 in tunnels else "",
                    health_url=tunnels[8080].url if 8080 in tunnels else "",
                    status_payload=status,
                    runtime_log_tail=log_tail,
                )
                if keep_alive:
                    return result
                await sb.terminate.aio()
                sb = None
                return result
            except Exception as exc:
                last_error = str(exc)
                await asyncio.sleep(2)

        log_tail = await runtime_log_tail(sb, root_dir) if sb is not None else ""
        raise ModalHarnessError(
            f"managed modal contract did not become healthy in time: {last_error}\n"
            f"sandbox_id={sb.object_id if sb is not None else ''}\n"
            f"last_status={last_status}\n"
            f"runtime_log_tail=\n{log_tail}"
        )
    finally:
        if sb is not None and not keep_alive:
            await sb.terminate.aio()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Managed Modal runtime debug/contract harness")
    parser.add_argument("--image-ref", default=os.environ.get("AGENTOBOX_MODAL_CONTRACT_IMAGE", "").strip())
    parser.add_argument("--callback-url", default=os.environ.get("AGENTOBOX_MODAL_CONTRACT_CALLBACK_URL", DEFAULT_CALLBACK_URL))
    parser.add_argument("--timeout-s", type=float, default=float(os.environ.get("AGENTOBOX_MODAL_CONTRACT_TIMEOUT_S", "60")))
    parser.add_argument("--app-name", default=os.environ.get("MODAL_APP_NAME", "agentobox"))
    parser.add_argument("--root-dir-base", default=os.environ.get("AGENTOBOX_MODAL_CONTRACT_ROOT_BASE", "/tmp/agentobox-contract"))
    parser.add_argument("--keep-alive", action="store_true", default=os.environ.get("AGENTOBOX_MODAL_CONTRACT_KEEP_ALIVE") == "1")
    parser.add_argument("--json", action="store_true", help="print machine-readable result JSON")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    image_ref = args.image_ref or os.environ.get("AGENTOBOX_MODAL_CONTRACT_IMAGE", "").strip()
    if not image_ref:
        print("AGENTOBOX_MODAL_CONTRACT_IMAGE or --image-ref is required", file=sys.stderr)
        return 2

    try:
        result = asyncio.run(
            run_managed_modal_contract(
                image_ref=image_ref,
                callback_url=args.callback_url,
                keep_alive=args.keep_alive,
                timeout_s=args.timeout_s,
                app_name=args.app_name,
                root_dir_base=args.root_dir_base,
            )
        )
    except ModalHarnessError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(asdict(result), indent=2))
    else:
        print(f"sandbox_id: {result.sandbox_id}")
        print(f"image_ref: {result.image_ref}")
        print(f"root_dir: {result.root_dir}")
        print(f"health_url: {result.health_url or '(none)'}")
        print(f"vnc_url: {result.vnc_url or '(none)'}")
        print("status_payload:")
        print(json.dumps(result.status_payload, indent=2))
        print("runtime_log_tail:")
        print(result.runtime_log_tail.rstrip() or "(empty)")
        if args.keep_alive:
            print(f"modal shell {result.sandbox_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
