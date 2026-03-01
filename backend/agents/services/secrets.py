"""
Fernet-based encryption for project secrets.

Secrets are stored as individually Fernet-encrypted values in the database.
Decrypted only during agent provisioning (to inject into MCP env blocks
or write to tmpfs).

The encryption key is read from settings.ABOX_ENCRYPTION_KEY. If not set,
secret creation raises an error rather than silently falling back.

Usage:
    from agents.services.secrets import encrypt_value, decrypt_value

    encrypted = encrypt_value("sk-ant-...")
    plaintext = decrypt_value(encrypted)  # -> "sk-ant-..."
"""

from cryptography.fernet import Fernet
from django.conf import settings


class EncryptionKeyMissing(Exception):
    """Raised when ABOX_ENCRYPTION_KEY is not configured."""


def _get_fernet() -> Fernet:
    """Return a Fernet instance using the configured encryption key."""
    key = getattr(settings, "ABOX_ENCRYPTION_KEY", "")
    if not key:
        raise EncryptionKeyMissing(
            "ABOX_ENCRYPTION_KEY is not set. Configure it in your environment "
            "before creating or reading secrets. Generate one with: "
            "python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    return Fernet(key.encode() if isinstance(key, str) else key)



def encrypt_value(value: str) -> bytes:
    """Encrypt a single secret value to a Fernet token."""
    f = _get_fernet()
    return f.encrypt(value.encode("utf-8"))


def decrypt_value(encrypted: bytes) -> str:
    """Decrypt a single Fernet token back to a string value."""
    f = _get_fernet()
    return f.decrypt(encrypted).decode("utf-8")


async def push_secrets_for_project(project) -> None:
    """Push merged secrets to all running agents in a project."""
    import structlog

    from agents.models import Agent, AgentStatus
    from agents.runtimes import get_runtime
    from agents.services.lifecycle import resolve_agent_secrets
    from agents.services.provision import push_secrets_to_agent

    op_log = structlog.get_logger("agents.secrets")

    running_agents = [
        a async for a in Agent.objects.filter(
            project=project,
            status__in=[AgentStatus.RUNNING, AgentStatus.IDLE],
        ).exclude(sandbox_id="")
    ]

    for agent in running_agents:
        try:
            secret_envs = await resolve_agent_secrets(agent, op_log)
            if secret_envs:
                runtime = get_runtime(agent.runtime)
                await push_secrets_to_agent(
                    runtime, agent.sandbox_id, agent, secret_envs,
                )
        except Exception:  # intentional: one agent's push failure must not block other agents' secrets
            op_log.exception("secret_push_failed", agent_name=agent.name)
