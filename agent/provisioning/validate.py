from __future__ import annotations

import json
from pathlib import Path

from agent.contracts.provisioning import FileValidator, ProvisioningManifest


class ProvisioningValidationError(ValueError):
    pass


def validate_manifest(root: Path, manifest: ProvisioningManifest) -> None:
    for rel_path in manifest.required_files:
        _validate_one(root, rel_path, manifest.validators.get(rel_path, FileValidator.EXISTS))


def _validate_one(root: Path, rel_path: str, validator: FileValidator) -> None:
    path = root / rel_path
    if validator is FileValidator.EXISTS:
        if not path.exists():
            raise ProvisioningValidationError(f"Required path missing: {rel_path}")
        return

    if validator is FileValidator.NONEMPTY_FILE:
        if not path.is_file() or path.stat().st_size == 0:
            raise ProvisioningValidationError(f"Required non-empty file missing: {rel_path}")
        return

    if validator is FileValidator.VALID_JSON:
        if not path.is_file():
            raise ProvisioningValidationError(f"Required JSON file missing: {rel_path}")
        try:
            json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            raise ProvisioningValidationError(f"Invalid JSON in {rel_path}: {exc}") from exc
        return

    raise ProvisioningValidationError(f"Unknown validator for {rel_path}: {validator}")

