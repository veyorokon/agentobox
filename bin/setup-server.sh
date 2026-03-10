#!/usr/bin/env bash
# One-time application setup for a fresh EC2 instance.
# Expects: Docker and Docker Compose plugin already installed (via user_data).
# Expects: docker-compose.prod.yml, Caddyfile, .env.prod.example in /tmp/
# Caddy runs as a Docker container (docker-compose.prod.yml), NOT as a system service.
# Idempotent — safe to run multiple times.
set -euo pipefail

# ── Helpers (standalone — no dependency on bin/lib.sh) ────────────────

_W=50

banner() {
  local title="$1"; shift
  local desc="$1"; shift
  local pad=$(( _W - ${#title} - 4 ))
  printf '\n\033[1m━━ %s \033[0m' "$title"
  printf '━%.0s' $(seq 1 $pad)
  printf '\n'
  if [ -n "$desc" ]; then
    printf '  %s\n\n' "$desc"
  fi
  while [ $# -ge 2 ]; do
    printf '  %-12s: %s\n' "$1" "$2"
    shift 2
  done
  printf '━%.0s' $(seq 1 $_W)
  printf '\n\n'
}

step() { printf '  → %s\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ⚠ %s\n' "$*"; }
die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }

APP_DIR=/opt/agentobox
COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

# ── 1. Directory structure ────────────────────────────────────────────

banner "setup-server" "Agentobox EC2 application setup"

step "Creating $APP_DIR directory structure..."
mkdir -p "$APP_DIR"
chown ubuntu:ubuntu "$APP_DIR"
ok "$APP_DIR ready"

# ── 2. Copy application files ────────────────────────────────────────

step "Copying application files..."

cp /tmp/docker-compose.prod.yml "$APP_DIR/docker-compose.prod.yml"
ok "docker-compose.prod.yml"

cp /tmp/Caddyfile "$APP_DIR/Caddyfile"
ok "Caddyfile"

# ── 3. Create .env (never overwrite — contains secrets) ──────────────

if [ -f "$APP_DIR/.env" ]; then
  warn ".env already exists — skipping (not overwritten)"
else
  cp /tmp/.env.prod.example "$APP_DIR/.env"
  warn ".env created from template — edit $APP_DIR/.env with real values before starting"
  warn "Required: DATABASE_URL, SECRET_KEY, ABOX_ENCRYPTION_KEY, DOMAIN"
fi

chown -R ubuntu:ubuntu "$APP_DIR"

# ── 4. GHCR login ────────────────────────────────────────────────────

step "Logging into GHCR..."
if [ -z "${GITHUB_TOKEN:-}" ]; then
  # Try reading from .env if not in environment
  if [ -f "$APP_DIR/.env" ] && grep -q '^GITHUB_TOKEN=' "$APP_DIR/.env"; then
    GITHUB_TOKEN=$(grep '^GITHUB_TOKEN=' "$APP_DIR/.env" | cut -d= -f2-)
  fi
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u veyorokon --password-stdin
  ok "GHCR login successful"
else
  warn "GITHUB_TOKEN not set — skipping GHCR login"
  warn "Set it in the environment or $APP_DIR/.env, then run:"
  warn "  echo \$GITHUB_TOKEN | docker login ghcr.io -u veyorokon --password-stdin"
fi

# ── 5. Pull images ───────────────────────────────────────────────────

step "Pulling images..."
cd "$APP_DIR"

if docker compose -f docker-compose.prod.yml pull 2>/dev/null; then
  ok "Images pulled"
else
  warn "Image pull failed — check GHCR login and .env VERSION settings"
  warn "You can pull manually: cd $APP_DIR && docker compose -f docker-compose.prod.yml pull"
fi

# ── 6. Start the stack ────────────────────────────────────────────────

step "Starting Docker Compose stack..."
docker compose -f docker-compose.prod.yml up -d
ok "Stack started"

# ── 7. Run migrations ────────────────────────────────────────────────

step "Waiting for backend to be ready..."
sleep 5

step "Running database migrations..."
if docker compose -f docker-compose.prod.yml exec -T backend uv run python manage.py migrate --noinput; then
  ok "Migrations complete"
else
  warn "Migrations failed — backend may still be starting"
  warn "Run manually: cd $APP_DIR && docker compose -f docker-compose.prod.yml exec backend uv run python manage.py migrate"
fi

# ── 8. Summary ────────────────────────────────────────────────────────

DOMAIN=$(grep '^DOMAIN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || echo "NOT SET")
PUBLIC_IP=$(curl -s --max-time 3 http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "unknown")

banner "setup complete" "" \
  "app dir"     "$APP_DIR" \
  "domain"      "$DOMAIN" \
  "public IP"   "$PUBLIC_IP" \
  "health"      "https://$DOMAIN/health" \
  "dashboard"   "https://$DOMAIN"

printf '  Next steps:\n'
printf '    1. Verify %s/.env has real values\n' "$APP_DIR"
printf '    2. Point DNS for %s to %s\n' "$DOMAIN" "$PUBLIC_IP"
printf '    3. Check health: curl -s https://%s/health\n' "$DOMAIN"
printf '\n'
