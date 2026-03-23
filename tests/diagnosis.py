"""
Structured failure diagnosis for CI seam tests.

Emits a small, diagnosis-first JSON artifact when a critical seam test fails.
The artifact answers: what seam failed, what contract was expected, what the
first broken step was, and where to debug next.

Not a general observability platform. Not an envelope system. Just enough
structure to make CI failures crystal clear.

Usage:
    from tests.diagnosis import Diagnosis

    diag = Diagnosis(
        job="agent-smoke",
        seam="send_message_to_runtime",
        contract="message sent to agent must produce feed response",
    )
    diag.expect("mutation_accepted", True)
    diag.expect("feed_response_seen", True)
    diag.observe("mutation_accepted", True)
    diag.observe("feed_response_seen", False)
    diag.set_ids(agent_id="abc", project_id="def")
    diag.set_refs(runtime="modal", image_ref="ghcr.io/...")

    # On failure:
    diag.write("failure-diagnosis-agent-smoke")
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Fields every diagnosis artifact must have.
REQUIRED_FIELDS = frozenset({
    "job",
    "seam",
    "contract",
    "first_broken_step",
    "expected",
    "observed",
    "ids",
    "refs",
    "next_debug_target",
})


@dataclass
class Diagnosis:
    """Builds and writes a structured failure diagnosis artifact."""

    job: str
    seam: str
    contract: str
    next_debug_target: str = ""

    expected: dict[str, Any] = field(default_factory=dict)
    observed: dict[str, Any] = field(default_factory=dict)
    ids: dict[str, str] = field(default_factory=dict)
    refs: dict[str, str] = field(default_factory=dict)

    def expect(self, step: str, value: Any) -> None:
        """Declare what a step should produce."""
        self.expected[step] = value

    def observe(self, step: str, value: Any) -> None:
        """Record what a step actually produced."""
        self.observed[step] = value

    def set_ids(self, **kwargs: str) -> None:
        """Set concrete identifiers (agent_id, project_id, sandbox_id, etc.)."""
        self.ids.update(kwargs)

    def set_refs(self, **kwargs: str) -> None:
        """Set environment references (runtime, image_ref, environment, etc.)."""
        self.refs.update(kwargs)

    @property
    def first_broken_step(self) -> str:
        """Find the first expected step where observed != expected.

        Iterates in insertion order of expected — the order you declared
        expectations is the contract order.
        """
        for step, expected_val in self.expected.items():
            observed_val = self.observed.get(step)
            if observed_val != expected_val:
                return step
        return ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to the diagnosis artifact shape."""
        return {
            "job": self.job,
            "seam": self.seam,
            "contract": self.contract,
            "first_broken_step": self.first_broken_step,
            "expected": self.expected,
            "observed": self.observed,
            "ids": self.ids,
            "refs": self.refs,
            "next_debug_target": self.next_debug_target,
        }

    def write(self, artifact_name: str, directory: str = "") -> str:
        """Write the diagnosis JSON to disk.

        Args:
            artifact_name: Filename stem (e.g. "failure-diagnosis-agent-smoke").
            directory: Output directory. Defaults to current working directory
                       or DIAGNOSIS_ARTIFACT_DIR if set.

        Returns:
            Absolute path to the written file.
        """
        out_dir = directory or os.environ.get("DIAGNOSIS_ARTIFACT_DIR", ".")
        path = Path(out_dir) / f"{artifact_name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.to_dict(), indent=2) + "\n")
        return str(path.resolve())

    def summary_lines(self) -> list[str]:
        """Format a concise summary for GitHub Actions step summary."""
        lines = [
            f"**Seam:** `{self.seam}`",
            f"**Contract:** {self.contract}",
        ]
        broken = self.first_broken_step
        if broken:
            lines.append(f"**First broken step:** `{broken}`")
            expected_val = self.expected.get(broken)
            observed_val = self.observed.get(broken)
            lines.append(f"**Expected:** `{expected_val}` → **Observed:** `{observed_val}`")
        if self.ids:
            id_str = ", ".join(f"`{k}={v}`" for k, v in self.ids.items() if v)
            if id_str:
                lines.append(f"**IDs:** {id_str}")
        if self.next_debug_target:
            lines.append(f"**Next debug target:** {self.next_debug_target}")
        return lines


def validate_diagnosis(data: dict[str, Any]) -> list[str]:
    """Validate a diagnosis dict has the required shape.

    Returns a list of error messages. Empty list = valid.
    """
    errors = []
    missing = REQUIRED_FIELDS - set(data.keys())
    if missing:
        errors.append(f"missing fields: {sorted(missing)}")

    for dict_field in ("expected", "observed", "ids", "refs"):
        val = data.get(dict_field)
        if val is not None and not isinstance(val, dict):
            errors.append(f"{dict_field} must be a dict, got {type(val).__name__}")

    for str_field in ("job", "seam", "contract", "first_broken_step", "next_debug_target"):
        val = data.get(str_field)
        if val is not None and not isinstance(val, str):
            errors.append(f"{str_field} must be a str, got {type(val).__name__}")

    return errors


def write_incident_artifact(
    gql: Any,
    agent_id: str,
    artifact_name: str,
    *,
    note: str = "",
    directory: str = "",
) -> dict[str, str]:
    """Best-effort capture + write of an incident bundle artifact.

    Returns a small result dict:
      {
        "incident_id": "...",
        "path": "/abs/path/to/artifact.json",
        "error": "..."  # only when capture/query failed
      }

    Never raises. If capture is not possible, no artifact is written and
    the returned dict only contains an ``error`` field.
    """
    if not gql or not agent_id:
        return {"error": "incident capture skipped: missing gql or agent_id"}

    out_dir = directory or os.environ.get("DIAGNOSIS_ARTIFACT_DIR", ".")
    path = Path(out_dir) / f"{artifact_name}.json"
    path.parent.mkdir(parents=True, exist_ok=True)

    try:
        capture = gql.capture_incident(agent_id, note=note)
        incident_id = capture.get("incidentId", "")
        if not incident_id:
            return {"error": f"incident capture returned no incidentId: {capture!r}"}

        incident = gql.query_incident(incident_id)
        payload = {
            "capture": capture,
            "incident": incident,
        }
        path.write_text(json.dumps(payload, indent=2) + "\n")
        return {"incident_id": incident_id, "path": str(path.resolve())}
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"
        payload = {
            "capture_error": error,
            "agent_id": agent_id,
            "note": note,
        }
        path.write_text(json.dumps(payload, indent=2) + "\n")
        return {"error": error, "path": str(path.resolve())}


def attach_incident_refs(
    diag: Diagnosis,
    diagnosis_artifact_name: str,
    artifact_name: str,
    incident_result: dict[str, str],
    *,
    directory: str = "",
) -> str:
    """Attach incident metadata to an existing diagnosis artifact and rewrite it."""
    if incident_result.get("incident_id"):
        diag.set_refs(
            incident_id=incident_result["incident_id"],
            incident_artifact=f"{artifact_name}.json",
        )
    elif incident_result.get("error"):
        diag.set_refs(
            incident_capture_error=incident_result["error"],
            incident_artifact=f"{artifact_name}.json",
        )

    return diag.write(diagnosis_artifact_name, directory=directory)
