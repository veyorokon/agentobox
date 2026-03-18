import pytest

from config.telemetry import normalize_domain_field_names


pytestmark = pytest.mark.unit


def test_normalize_domain_field_names_renames_status_aliases():
    event = {
        "event": "lifecycle.status_transition",
        "from_status": "idle",
        "to_status": "error",
    }

    normalized = normalize_domain_field_names(None, None, event)

    assert normalized["previous_status"] == "idle"
    assert normalized["next_status"] == "error"
    assert "from_status" not in normalized
    assert "to_status" not in normalized


def test_normalize_domain_field_names_preserves_canonical_fields():
    event = {
        "event": "lifecycle.status_transition",
        "previous_status": "idle",
        "next_status": "error",
        "from_status": "stale-old",
        "to_status": "stale-new",
    }

    normalized = normalize_domain_field_names(None, None, event)

    assert normalized["previous_status"] == "idle"
    assert normalized["next_status"] == "error"
