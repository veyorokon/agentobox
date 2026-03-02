#!/bin/bash
set -e

echo "Running migrations..."
uv run python manage.py migrate --noinput

echo "Seeding dev data..."
uv run python manage.py seed_dev_data 2>/dev/null || true

exec "$@"
