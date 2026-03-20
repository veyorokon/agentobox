.PHONY: dev migrate makemigrations createsuperuser check schema codegen agent-image agent-image-runtime agent-image-runtime-managed agent-image-runtime-desktop agent-image-runtime-desktop-managed up down docs test test-local test-agent _test-backend _test-agent _test-dashboard lint test-e2e test-e2e-full test-e2e-agents test-e2e-dashboard test-integration seed test-unit test-invariant test-all test-bootstrap test-smoke test-smoke-modal test-modal-local-bootstrap test-agent-contract test-agent-runtime-docker-contract test-agent-runtime-desktop-docker-contract test-agent-runtime-modal-contract modal-contract modal-debug test-backend-unit test-backend-integration test-backend-chaos test-backend-architecture test-backend-lint test-agent-unit test-agent-lint test-dashboard-unit test-dashboard-typecheck test-ci-fast test-ci-smoke-bootstrap test-ci-smoke-roundtrip tf-bootstrap tf-init tf-plan tf-apply tf-output tf-destroy tf-pull tf-push ssh aws-check setup-server smoke

dev:
	uv --directory backend run daphne -b 0.0.0.0 -p 8000 config.asgi:application

migrate:
	uv --directory backend run python manage.py migrate

makemigrations:
	uv --directory backend run python manage.py makemigrations

createsuperuser:
	uv --directory backend run python manage.py createsuperuser

check:
	uv --directory backend run python manage.py check

schema:
	docker compose exec -T backend uv run python -c "import os; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings'); import django; django.setup(); from schema import schema; print(schema.as_str())" > dashboard/schema.graphql

codegen: schema
	cd dashboard && pnpm codegen

PLATFORM ?= linux/amd64
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null)

agent-image: agent-image-runtime-desktop-managed

agent-image-runtime:
	docker build --platform $(PLATFORM) --build-arg AGENTOBOX_GIT_COMMIT=$(GIT_COMMIT) -f agent/Dockerfile -t agentobox-agent-runtime:latest ./agent

agent-image-runtime-managed:
	docker build --platform $(PLATFORM) --build-arg AGENTOBOX_GIT_COMMIT=$(GIT_COMMIT) -f agent/Dockerfile.managed -t agentobox-agent-runtime-managed:latest ./agent

agent-image-runtime-desktop: agent-image-runtime
	docker build --platform $(PLATFORM) --build-arg BASE_IMAGE=agentobox-agent-runtime:latest --build-arg AGENTOBOX_GIT_COMMIT=$(GIT_COMMIT) -f agent/Dockerfile.desktop -t agentobox-agent-runtime-desktop:latest ./agent

agent-image-runtime-desktop-managed: agent-image-runtime-managed
	docker build --platform $(PLATFORM) --build-arg BASE_IMAGE=agentobox-agent-runtime-managed:latest --build-arg AGENTOBOX_GIT_COMMIT=$(GIT_COMMIT) -f agent/Dockerfile.desktop.managed -t agentobox-agent-runtime-desktop-managed:latest ./agent

up:
	AGENT_VERSION=$$(git describe --tags --abbrev=0 2>/dev/null | sed 's/^v//' || echo latest) docker compose up --build

down:
	docker compose down

docs:
	docker compose exec -T backend uv run python manage.py generate_reference --to-stdout > docs/REFERENCE.md
	node dashboard/scripts/generate-reference.mjs
	python agent/scripts/generate-reference.py

test:
	docker compose exec backend uv run python -m pytest agents/tests/ -v

test-local: _test-backend _test-agent _test-dashboard

_test-backend:
	uv --directory backend run python -m pytest agents/tests/ -v

_test-agent:
	uv run --project . pytest agent/tests/ tests/architecture/ -v -o "addopts="

_test-dashboard:
	cd dashboard && pnpm vitest run

test-agent:
	PYTHONPATH=$(CURDIR) uv --directory agent run pytest tests/ -v -o addopts=

test-backend-unit:
	uv --directory backend run pytest -m "unit" --tb=short -q

test-backend-integration:
	uv --directory backend run pytest -m "integration" --tb=short -q -o "DJANGO_SETTINGS_MODULE=config.settings"

test-backend-chaos:
	uv --directory backend run pytest -m "chaos" --tb=short -q

test-backend-architecture:
	uv --directory backend run python agents/tests/check_architecture.py

test-backend-lint:
	uv --directory backend run ruff check agents/

test-agent-unit:
	PYTHONPATH=$(CURDIR) uv --directory agent run pytest tests/ -q -o addopts=

test-agent-contract:
	PYTHONPATH=$(CURDIR) uv --directory agent run pytest -m "contract" tests/ -q -o addopts=

test-agent-lint:
	uv --directory agent run ruff check .

test-dashboard-unit:
	cd dashboard && pnpm vitest run

test-dashboard-typecheck:
	cd dashboard && pnpm exec tsc --noEmit

test-ci-fast: test-backend-unit test-backend-integration test-backend-chaos test-backend-architecture test-backend-lint test-agent-unit test-agent-lint test-dashboard-unit test-dashboard-typecheck lint

test-ci-smoke-bootstrap:
	uv run --project . --group e2e pytest tests/e2e/lifecycle/test_agent_boot.py::TestAgentBoot -v --timeout=300 -o "addopts="

test-ci-smoke-roundtrip:
	uv run --project . --group e2e pytest tests/smoke/ -v --timeout=300 -o "addopts="

test-agent-runtime-docker-contract:
	AGENTOBOX_RUN_DOCKER_CONTRACT_TESTS=1 ./.venv/bin/python -m pytest agent/tests/test_managed_docker_contract.py -q -o addopts=

test-agent-runtime-desktop-docker-contract:
	AGENTOBOX_RUN_DOCKER_CONTRACT_TESTS=1 ./.venv/bin/python -m pytest agent/tests/test_managed_docker_contract.py -q -o addopts= -k desktop

test-agent-runtime-modal-contract:
	AGENTOBOX_RUN_MODAL_CONTRACT_TESTS=1 PYTHONPATH=$(CURDIR) uv --directory agent run pytest tests/test_managed_modal_contract.py -q -o addopts=

modal-contract:
	uv run --project agent python agent/scripts/modal_managed_harness.py --image-ref "$${AGENTOBOX_MODAL_CONTRACT_IMAGE:?set AGENTOBOX_MODAL_CONTRACT_IMAGE}" --callback-url "$${AGENTOBOX_MODAL_CONTRACT_CALLBACK_URL:-https://example.com/graphql}"

modal-debug:
	uv run --project agent python agent/scripts/modal_managed_harness.py --image-ref "$${AGENTOBOX_MODAL_CONTRACT_IMAGE:?set AGENTOBOX_MODAL_CONTRACT_IMAGE}" --callback-url "$${AGENTOBOX_MODAL_CONTRACT_CALLBACK_URL:-https://example.com/graphql}" --keep-alive

lint:
	uv --directory backend run ruff check agents/
	cd dashboard && pnpm next lint

test-e2e:
	uv run --project . --group e2e pytest tests/e2e/ -v || test $$? -eq 5

test-e2e-full:
	uv run --project . --group e2e pytest tests/e2e/ -v -m "e2e"

test-e2e-agents:
	uv run --project . --group e2e pytest tests/e2e/ -v -m "e2e and agent"

test-e2e-dashboard:
	uv run --project . --group e2e pytest tests/e2e/ -v -m "e2e and dashboard"

test-integration:
	uv run --project . --group e2e pytest tests/integration/ -v --timeout=30 -m "integration" -o "addopts="

test-visual:
	ABOX_VISUAL_TESTS=1 uv run pytest agent/tests/test_theme_visual.py -v --timeout=120 -s

test-unit: test-backend-unit

test-invariant:
	uv --directory backend run pytest -m "invariant" --tb=short -q

test-all:
	docker compose exec backend uv run pytest --tb=short -q

test-bootstrap: test-ci-smoke-bootstrap

test-smoke: test-ci-smoke-roundtrip

test-smoke-modal:
	SMOKE_RUNTIME=modal uv run --project . --group e2e pytest tests/smoke/ -v --timeout=300 -o "addopts="

test-modal-local-bootstrap:
	bash bin/modal-local-bootstrap

seed:
	docker compose exec backend uv run python manage.py seed_dev_data

# ── Infrastructure ─────────────────────────────────────────────────────

ENV ?= dev
TF_DIR = infra/environments/$(ENV)

# All tf-* targets unset env var AWS keys so the agentobox profile is used.
# The profile is set in the backend and provider blocks of each environment.

tf-bootstrap: ## One-time: create S3 bucket + DynamoDB table for TF state
	@. bin/lib.sh; \
	banner "tf-bootstrap" "Create Terraform state backend" \
		"bucket" "agentobox-tfstate" \
		"lock table" "agentobox-tflock"; \
	ensure_aws || exit 1; \
	cd infra/bootstrap && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform init && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform apply

tf-pull: ## Pull tfvars from GitHub environment. ENV=dev
	@. bin/lib.sh; \
	step "Pulling TFVARS for $(ENV)..."; \
	gh api repos/veyorokon/agentobox/environments/$(ENV)/variables/TFVARS --jq '.value' \
		> $(TF_DIR)/terraform.tfvars && \
	ok "Wrote $(TF_DIR)/terraform.tfvars"

tf-push: ## Push tfvars to GitHub environment. ENV=dev
	@. bin/lib.sh; \
	step "Pushing TFVARS for $(ENV)..."; \
	gh api -X PATCH repos/veyorokon/agentobox/environments/$(ENV)/variables/TFVARS \
		-f value="$$(cat $(TF_DIR)/terraform.tfvars)" && \
	ok "Updated TFVARS for $(ENV)"

tf-init: ## Terraform init. ENV=dev
	@. bin/lib.sh; \
	banner "tf-init" "Initialize Terraform" \
		"environment" "$(ENV)" \
		"directory" "$(TF_DIR)"; \
	ensure_aws || exit 1; \
	cd $(TF_DIR) && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform init

tf-plan: ## Terraform plan. ENV=dev
	@. bin/lib.sh; \
	banner "tf-plan" "Plan infrastructure changes" \
		"environment" "$(ENV)" \
		"directory" "$(TF_DIR)"; \
	ensure_aws || exit 1; \
	cd $(TF_DIR) && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform plan

tf-apply: ## Terraform apply. ENV=dev
	@. bin/lib.sh; \
	banner "tf-apply" "Apply infrastructure changes" \
		"environment" "$(ENV)" \
		"directory" "$(TF_DIR)"; \
	ensure_aws || exit 1; \
	cd $(TF_DIR) && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform apply

tf-output: ## Terraform output. ENV=dev
	@cd $(TF_DIR) && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform output

tf-destroy: ## Terraform destroy. ENV=dev (USE WITH CAUTION)
	@. bin/lib.sh; \
	banner "tf-destroy" "DESTROY infrastructure" \
		"environment" "$(ENV)" \
		"directory" "$(TF_DIR)"; \
	ensure_aws || exit 1; \
	cd $(TF_DIR) && \
	env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
		terraform destroy

ssh: ## SSH into EC2 instance. ENV=dev
	@cd $(TF_DIR) && \
	ssh ubuntu@$$(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY terraform output -raw public_ip)

aws-check: ## Verify AWS credentials for agentobox profile
	@. bin/lib.sh; ensure_aws

setup-server: ## Initial server setup — SCP files + run setup script. ENV=dev
	@. bin/lib.sh; \
	banner "setup-server" "Set up EC2 application stack" \
		"environment" "$(ENV)"; \
	ensure_aws || exit 1; \
	IP=$$(cd $(TF_DIR) && env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY terraform output -raw public_ip); \
	step "Server IP: $$IP"; \
	step "Copying files to server..."; \
	scp docker-compose.prod.yml Caddyfile .env.prod.example bin/setup-server.sh ubuntu@$$IP:/tmp/; \
	ok "Files copied"; \
	step "Running setup script..."; \
	ssh ubuntu@$$IP 'sudo bash /tmp/setup-server.sh'


smoke:
	@bash bin/smoke-test.sh https://dev.agentobox.com
