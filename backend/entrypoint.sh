#!/bin/bash
set -e

echo "Collecting static files..."
uv run python manage.py collectstatic --noinput

echo "Running migrations..."
uv run python manage.py migrate --noinput

exec "$@"
