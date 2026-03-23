"""
Unit tests for the failure diagnosis artifact schema.

Validates the Diagnosis helper produces correct shape and that
validate_diagnosis catches drift. Not a CI-failure test — just
schema enforcement.
"""

import json
import tempfile

import pytest

from tests.diagnosis import (
    Diagnosis,
    REQUIRED_FIELDS,
    attach_incident_refs,
    validate_diagnosis,
    write_incident_artifact,
)


class TestDiagnosisSchema:
    """Ensure the diagnosis artifact shape cannot silently drift."""

    def _make_diagnosis(self) -> Diagnosis:
        diag = Diagnosis(
            job="agent-smoke",
            seam="send_message_to_runtime",
            contract="message must produce feed response",
        )
        diag.expect("mutation_accepted", True)
        diag.expect("feed_response_seen", True)
        diag.observe("mutation_accepted", True)
        diag.observe("feed_response_seen", False)
        diag.set_ids(agent_id="a-123", project_id="p-456")
        diag.set_refs(runtime="modal", image_ref="ghcr.io/test:sha-abc")
        diag.next_debug_target = "inspect relay inbox"
        return diag

    def test_to_dict_has_all_required_fields(self):
        diag = self._make_diagnosis()
        data = diag.to_dict()
        assert set(data.keys()) == REQUIRED_FIELDS

    def test_first_broken_step_identifies_correct_step(self):
        diag = self._make_diagnosis()
        assert diag.first_broken_step == "feed_response_seen"

    def test_first_broken_step_empty_when_all_pass(self):
        diag = Diagnosis(job="test", seam="test", contract="test")
        diag.expect("a", True)
        diag.observe("a", True)
        assert diag.first_broken_step == ""

    def test_first_broken_step_respects_insertion_order(self):
        diag = Diagnosis(job="test", seam="test", contract="test")
        diag.expect("step_1", True)
        diag.expect("step_2", True)
        diag.expect("step_3", True)
        diag.observe("step_1", True)
        diag.observe("step_2", False)
        diag.observe("step_3", False)
        assert diag.first_broken_step == "step_2"

    def test_validate_diagnosis_accepts_valid(self):
        diag = self._make_diagnosis()
        errors = validate_diagnosis(diag.to_dict())
        assert errors == []

    def test_validate_diagnosis_catches_missing_fields(self):
        data = {"job": "test", "seam": "test"}
        errors = validate_diagnosis(data)
        assert any("missing fields" in e for e in errors)

    def test_validate_diagnosis_catches_wrong_types(self):
        diag = self._make_diagnosis()
        data = diag.to_dict()
        data["expected"] = "not a dict"
        errors = validate_diagnosis(data)
        assert any("expected must be a dict" in e for e in errors)

    def test_write_produces_valid_json(self):
        diag = self._make_diagnosis()
        with tempfile.TemporaryDirectory() as tmpdir:
            path = diag.write("failure-diagnosis-test", directory=tmpdir)
            with open(path) as f:
                data = json.load(f)
            errors = validate_diagnosis(data)
            assert errors == [], f"Written artifact failed validation: {errors}"

    def test_summary_lines_includes_broken_step(self):
        diag = self._make_diagnosis()
        lines = diag.summary_lines()
        text = "\n".join(lines)
        assert "feed_response_seen" in text
        assert "send_message_to_runtime" in text

    def test_no_extra_fields_in_artifact(self):
        """Artifact must contain exactly the required fields — no more."""
        diag = self._make_diagnosis()
        data = diag.to_dict()
        extra = set(data.keys()) - REQUIRED_FIELDS
        assert extra == set(), f"Unexpected fields in artifact: {extra}"

    def test_write_incident_artifact_writes_bundle_payload(self):
        class FakeGQL:
            def capture_incident(self, agent_id, note=""):
                assert agent_id == "a-123"
                assert note == "smoke failure"
                return {"incidentId": "inc-1", "agentId": agent_id}

            def query_incident(self, incident_id):
                assert incident_id == "inc-1"
                return {"id": incident_id, "bundle": {"observed": {"runtime_task_state": "failed"}}}

        with tempfile.TemporaryDirectory() as tmpdir:
            result = write_incident_artifact(
                FakeGQL(),
                "a-123",
                "incident-agent-smoke",
                note="smoke failure",
                directory=tmpdir,
            )

            assert result["incident_id"] == "inc-1"
            with open(result["path"]) as f:
                data = json.load(f)

            assert data["capture"]["incidentId"] == "inc-1"
            assert data["incident"]["bundle"]["observed"]["runtime_task_state"] == "failed"

    def test_write_incident_artifact_writes_error_payload_on_failure(self):
        class FakeGQL:
            def capture_incident(self, agent_id, note=""):
                raise RuntimeError("boom")

        with tempfile.TemporaryDirectory() as tmpdir:
            result = write_incident_artifact(
                FakeGQL(),
                "a-123",
                "incident-agent-smoke",
                note="smoke failure",
                directory=tmpdir,
            )

            assert "error" in result
            with open(result["path"]) as f:
                data = json.load(f)

            assert "capture_error" in data
            assert data["agent_id"] == "a-123"

    def test_attach_incident_refs_rewrites_diagnosis_with_incident_pointer(self):
        diag = self._make_diagnosis()
        with tempfile.TemporaryDirectory() as tmpdir:
            path = attach_incident_refs(
                diag,
                "failure-diagnosis-agent-smoke",
                "incident-agent-smoke",
                {"incident_id": "inc-1", "path": "/tmp/incident-agent-smoke.json"},
                directory=tmpdir,
            )
            with open(path) as f:
                data = json.load(f)

            assert data["refs"]["incident_id"] == "inc-1"
            assert data["refs"]["incident_artifact"] == "incident-agent-smoke.json"
