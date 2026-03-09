.PHONY: dev migrate makemigrations createsuperuser check schema agent-image agent-image-base agent-image-claude up down docs test test-local _test-backend _test-agent _test-dashboard lint test-e2e test-e2e-full test-e2e-agents test-e2e-dashboard test-integration seed test-unit test-invariant test-all

dev:
	cd backend && uv run daphne -b 0.0.0.0 -p 8000 config.asgi:application

migrate:
	cd backend && uv run python manage.py migrate

makemigrations:
	cd backend && uv run python manage.py makemigrations

createsuperuser:
	cd backend && uv run python manage.py createsuperuser

check:
	cd backend && uv run python manage.py check

schema:
	docker compose exec -T backend uv run python -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); import django; django.setup(); from schema import schema; print(schema.as_str())" > dashboard/schema.graphql

PLATFORM ?= linux/amd64

agent-image-base:
	docker build --platform $(PLATFORM) -f agent/Dockerfile.base -t agentobox-agent-base:latest ./agent

agent-image-claude: agent-image-base
	docker build --platform $(PLATFORM) --build-arg BASE_IMAGE=agentobox-agent-base:latest -f agent/claude/Dockerfile -t agentobox-agent-claude:latest ./agent

agent-image: agent-image-claude

up:
	AGENT_VERSION=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo latest) docker compose up --build

down:
	docker compose down

docs:
	docker compose exec -T backend uv run python manage.py generate_reference --to-stdout > docs/REFERENCE.md

test:
	docker compose exec backend uv run python -m pytest agents/tests/ -v

test-local: _test-backend _test-agent _test-dashboard

_test-backend:
	cd backend && uv run python -m pytest agents/tests/ -v

_test-agent:
	uv run pytest agent/tests/ tests/architecture/ -v -o "addopts="

_test-dashboard:
	cd dashboard && npx vitest run

test-agent:
	docker run --rm --entrypoint python3 -v ./agent/tests:/opt/abox/tests agentobox-agent-claude:latest \
		-m pytest /opt/abox/tests -v

lint:
	cd backend && uv run ruff check agents/
	cd dashboard && npx next lint

test-e2e:
	uv run --group e2e pytest tests/e2e/ -v || test $$? -eq 5

test-e2e-full:
	uv run --group e2e pytest tests/e2e/ -v -m "e2e"

test-e2e-agents:
	uv run --group e2e pytest tests/e2e/ -v -m "e2e and agent"

test-e2e-dashboard:
	uv run --group e2e pytest tests/e2e/ -v -m "e2e and dashboard"

test-integration:
	uv run --group e2e pytest tests/integration/ -v --timeout=30 -m "integration" -o "addopts="

test-visual:
	ABOX_VISUAL_TESTS=1 uv run pytest agent/tests/test_theme_visual.py -v --timeout=120 -s

test-unit:
	cd backend && uv run pytest -m "unit" --tb=short -q

test-invariant:
	cd backend && uv run pytest -m "invariant" --tb=short -q

test-all:
	docker compose exec backend uv run pytest --tb=short -q

seed:
	docker compose exec backend uv run python manage.py seed_dev_data
