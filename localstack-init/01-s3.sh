#!/usr/bin/env bash
# Create S3 buckets on LocalStack startup.
set -euo pipefail

BUCKET="${MEDIA_BUCKET:-agentobox-media}"

echo "Creating S3 bucket: $BUCKET"
awslocal s3 mb "s3://$BUCKET" 2>/dev/null || echo "Bucket $BUCKET already exists"
echo "S3 buckets ready"
