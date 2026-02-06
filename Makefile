.PHONY: dev migrate makemigrations createsuperuser check schema agent-image up down

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
	cd backend && uv run python -c "from schema import schema; print(schema.as_str())" > dashboard/schema.graphql

agent-image:
	docker build -t agentobox-agent:latest ./agent

up:
	docker compose up --build

down:
	docker compose down
