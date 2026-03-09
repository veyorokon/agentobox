"""Tests for agents.services.comms — content normalization and SSRF prevention."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.services.comms import _normalize_content, send_message

pytestmark = pytest.mark.unit


def _image_block(url, media_type=None):
    """Helper: build an image content block with a URL source."""
    source = {"type": "url", "url": url}
    if media_type:
        source["media_type"] = media_type
    return {"type": "image", "source": source}


# ---------------------------------------------------------------------------
# SSRF prevention: untrusted hosts are skipped
# ---------------------------------------------------------------------------


def test_normalize_content_blocks_untrusted_host():
    """Non-allowlisted host is skipped — block is left with its original URL source."""
    block = _image_block("http://evil.example.com/image.png")
    result = _normalize_content([block])

    # Block should still have the original URL source (not converted to base64)
    assert result[0]["source"]["type"] == "url"
    assert result[0]["source"]["url"] == "http://evil.example.com/image.png"


# ---------------------------------------------------------------------------
# Allowlisted hosts: localhost and localstack
# ---------------------------------------------------------------------------


def test_normalize_content_allows_localhost():
    """localhost URLs are fetched and converted to base64."""
    fake_resp = MagicMock()
    fake_resp.read.return_value = b"\x89PNG\r\n\x1a\n"  # minimal PNG magic bytes
    fake_resp.headers = {"Content-Type": "image/png"}

    block = _image_block("http://localhost:4566/bucket/image.png")

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock_urlopen:
        result = _normalize_content([block])

    # urlopen should be called with localhost rewritten to localstack
    mock_urlopen.assert_called_once()
    called_url = mock_urlopen.call_args[0][0]
    assert "localstack:" in called_url

    # Block should now be base64
    assert result[0]["source"]["type"] == "base64"
    assert result[0]["source"]["media_type"] == "image/png"
    assert "data" in result[0]["source"]


def test_normalize_content_allows_localstack():
    """localstack URLs are fetched directly."""
    fake_resp = MagicMock()
    fake_resp.read.return_value = b"\x89PNG\r\n\x1a\n"
    fake_resp.headers = {"Content-Type": "image/png"}

    block = _image_block("http://localstack:4566/bucket/image.png")

    with patch("urllib.request.urlopen", return_value=fake_resp) as mock_urlopen:
        result = _normalize_content([block])

    mock_urlopen.assert_called_once()
    assert result[0]["source"]["type"] == "base64"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_normalize_content_strips_media_type_from_url_source():
    """media_type is removed from URL sources (only valid for base64)."""
    block = _image_block("https://cdn.example.com/photo.jpg", media_type="image/jpeg")
    result = _normalize_content([block])

    # HTTPS URLs are left as-is (no fetch) but media_type is stripped
    assert "media_type" not in result[0]["source"]
    assert result[0]["source"]["type"] == "url"


def test_normalize_content_ignores_non_url_blocks():
    """Text blocks and base64 blocks pass through unchanged."""
    blocks = [
        {"type": "text", "text": "hello"},
        {"type": "image", "source": {"type": "base64", "data": "abc", "media_type": "image/png"}},
    ]
    result = _normalize_content(blocks)
    assert result[0] == {"type": "text", "text": "hello"}
    assert result[1]["source"]["type"] == "base64"


# ---------------------------------------------------------------------------
# WebSocket push on send_message
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_send_message_pushes_to_dashboard_ws():
    """send_message() triggers a WebSocket push for the agent timeline update."""
    # Mock agent
    fake_agent = MagicMock()
    fake_agent.id = "agent-123"
    fake_agent.project_id = "proj-456"
    fake_agent.session_id = "session-789"
    fake_agent.status = "running"

    # Mock stream event
    fake_stream_event = MagicMock()
    fake_stream_event.id = "event-abc"

    # Mock channel layer
    mock_channel_layer = MagicMock()
    mock_channel_layer.group_send = AsyncMock()

    # Mock serialized agent
    fake_serialized_agent = {"_t": "agent", "id": "agent-123", "name": "test-agent"}

    # Mock volume for _send_via_inbox
    fake_volume = MagicMock()
    fake_agent.volume = fake_volume

    with (
        patch("agents.services.comms.Agent.objects.aget", new_callable=AsyncMock, return_value=fake_agent),
        patch("agents.services.comms.create_stream_event", new_callable=AsyncMock, return_value=fake_stream_event),
        patch("agents.services.comms.push_to_relay", new_callable=AsyncMock),
        patch("agents.services.comms.get_channel_layer", return_value=mock_channel_layer),
        patch("agents.consumers._serialize_agent_for_ws", new_callable=AsyncMock, return_value=fake_serialized_agent),
    ):
        result = await send_message("agent-123", "Hello agent!")

    # Assert send_message succeeded
    assert result is True

    # Assert WebSocket push was triggered
    mock_channel_layer.group_send.assert_called_once()
    call_args = mock_channel_layer.group_send.call_args
    assert call_args[0][0] == "dashboard_proj-456"  # group name
    assert call_args[0][1]["type"] == "dashboard.agent_update"
    assert call_args[0][1]["payload"] == fake_serialized_agent
