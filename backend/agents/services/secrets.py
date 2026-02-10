"""
Fernet-based encryption for SecretGroup data.

Secrets are stored as Fernet-encrypted JSON blobs in the database.
Decrypted only during agent provisioning (to inject into MCP env blocks
or write to tmpfs).

The encryption key is read from settings.ABOX_ENCRYPTION_KEY. If not set,
secret creation raises an error rather than silently falling back.

Usage:
    from agents.services.secrets import encrypt_secrets, decrypt_secrets

    encrypted = encrypt_secrets({"SUPABASE_URL": "https://...", "SUPABASE_KEY": "eyJ..."})
    plaintext = decrypt_secrets(encrypted)  # -> {"SUPABASE_URL": "...", ...}
"""

import json

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


def encrypt_secrets(data: dict[str, str]) -> bytes:
    """Encrypt a dict of key-value pairs to a Fernet token (bytes)."""
    f = _get_fernet()
    plaintext = json.dumps(data).encode("utf-8")
    return f.encrypt(plaintext)


def decrypt_secrets(encrypted: bytes) -> dict[str, str]:
    """Decrypt a Fernet token back to the original key-value dict."""
    f = _get_fernet()
    plaintext = f.decrypt(encrypted)
    return json.loads(plaintext.decode("utf-8"))
