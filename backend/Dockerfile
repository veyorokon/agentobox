FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

COPY backend/pyproject.toml backend/uv.lock ./
COPY libs/gda_kernel /libs/gda_kernel
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/. .
COPY shared /shared

EXPOSE 8000

ENTRYPOINT ["bash", "/app/entrypoint.sh"]
CMD ["uv", "run", "daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
