"""Tests for agents.services.comms — content normalization and SSRF prevention."""

from unittest.mock import MagicMock, patch

from agents.services.comms import _normalize_content


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
