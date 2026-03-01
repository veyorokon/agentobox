"""
S3 media externalization for base64 image content blocks.

Uploads base64-encoded images to S3 (LocalStack in dev, DigitalOcean Spaces in prod)
and returns a public URL. Used by stream.py to swap inline base64 data with URLs
before storing Messages in the database.
"""

import base64
import mimetypes
import uuid

import boto3
import structlog
from django.conf import settings

log = structlog.get_logger("agents.media")


_s3_client = None


def _get_s3_client():
    """Get or create cached S3 client. boto3 reads AWS_* env vars automatically."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3")
    return _s3_client


def _ext_from_media_type(media_type: str) -> str:
    ext = mimetypes.guess_extension(media_type or "image/png")
    return ext or ".png"


def upload_raw(data: bytes, media_type: str, prefix: str = "media") -> str:
    """Upload raw bytes to S3, return the public URL."""
    client = _get_s3_client()
    ext = _ext_from_media_type(media_type)
    key = f"{prefix}/{uuid.uuid4()}{ext}"
    client.put_object(
        Bucket=settings.MEDIA_BUCKET,
        Key=key,
        Body=data,
        ContentType=media_type,
    )
    if settings.MEDIA_CDN_URL:
        return f"{settings.MEDIA_CDN_URL}/{key}"
    endpoint = client.meta.endpoint_url
    return f"{endpoint}/{settings.MEDIA_BUCKET}/{key}"


def upload_base64_image(data_b64: str, media_type: str, prefix: str = "media") -> str:
    """Upload base64-encoded image to S3, return the public URL.

    Bucket must already exist — created by localstack-init/01-s3.sh in dev,
    pre-provisioned in prod.
    """
    client = _get_s3_client()
    raw = base64.b64decode(data_b64)
    ext = _ext_from_media_type(media_type)
    key = f"{prefix}/{uuid.uuid4()}{ext}"

    client.put_object(
        Bucket=settings.MEDIA_BUCKET,
        Key=key,
        Body=raw,
        ContentType=media_type or "image/png",
    )

    if settings.MEDIA_CDN_URL:
        return f"{settings.MEDIA_CDN_URL}/{key}"

    # LocalStack / direct S3 URL
    endpoint = client.meta.endpoint_url
    return f"{endpoint}/{settings.MEDIA_BUCKET}/{key}"


def externalize_image_block(block: dict, prefix: str = "media") -> dict:
    """If block is a base64 image, upload to S3 and swap source to URL.

    Only converts to URL when MEDIA_CDN_URL is set (i.e. a public HTTPS
    endpoint exists). In dev (LocalStack), the URL is HTTP localhost which
    the Anthropic API can't reach — so we keep base64 for the API and
    still upload to S3 for dashboard display.
    """
    if block.get("type") != "image":
        return block
    source = block.get("source", {})
    if source.get("type") != "base64" or not source.get("data"):
        return block

    media_type = source.get("media_type", "image/png")
    try:
        url = upload_base64_image(source["data"], media_type, prefix)
        if not settings.MEDIA_CDN_URL:
            # No public URL available — keep base64 for the API
            return block
        return {
            **block,
            "source": {"type": "url", "url": url},
        }
    except Exception:  # intentional: S3 upload fail-open — keep base64 so API call still works
        log.exception("externalize_image_failed")
        return block
