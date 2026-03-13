"""
Fernet-based encryption for project secrets.

Secrets are stored as individually Fernet-encrypted values in the database.
Decrypted only during agent provisioning (to inject into MCP env blocks
or write to tmpfs).

The encryption key is read from app_config.encryption_key. If not set,
secret creation raises an error rather than silently falling back.

Usage:
    from agents.services.secrets import encrypt_value, decrypt_value

    encrypted = encrypt_value("sk-ant-...")
    plaintext = decrypt_value(encrypted)  # -> "sk-ant-..."
"""

from cryptography.fernet import Fernet
from config.app_config import app_config


class EncryptionKeyMissing(Exception):
    """Raised when ABOX_ENCRYPTION_KEY is not configured."""


def _get_fernet() -> Fernet:
    """Return a Fernet instance using the configured encryption key."""
    key = app_config.encryption_key
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

    from agents.services.lifecycle import resolve_agent_secrets
    from agents.services.provision import push_secrets_to_agent

    op_log = structlog.get_logger("abox.lifecycle")

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
                await push_secrets_to_agent(agent, secret_envs)
        except Exception as exc:  # intentional: one agent's push failure must not block other agents' secrets
            from agents.errors import ERR_SECRETS_PUSH_FAILED
            op_log.exception(
                "lifecycle.secret_push_failed",
                agent_name=agent.name,
                error_code=ERR_SECRETS_PUSH_FAILED,
                error_class=type(exc).__name__,
                operation="push_secrets_to_agent",
                agent_id=str(agent.id),
            )
