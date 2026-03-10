#!/usr/bin/env bash
# Shared message functions for Makefile targets.
# Sourced (not executed): . bin/lib.sh

_W=50  # banner width

banner() {
  local title="$1"; shift
  local desc="$1"; shift
  local pad=$(( _W - ${#title} - 4 ))
  printf '\n━━ %s ' "$title"
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

error_banner() {
  printf '\n━━ ERROR '
  printf '━%.0s' $(seq 1 $((_W - 9)))
  printf '\n'
  while [ $# -gt 0 ]; do
    printf '  %s\n' "$1"
    shift
  done
  printf '━%.0s' $(seq 1 $_W)
  printf '\n'
}

# Ensure AWS credentials are valid for the agentobox profile.
# Usage: ensure_aws
ensure_aws() {
  step "Checking AWS credentials (profile: agentobox)..."
  if env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
     AWS_PROFILE=agentobox aws sts get-caller-identity >/dev/null 2>&1; then
    ok "Authenticated (account $(env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY AWS_PROFILE=agentobox aws sts get-caller-identity --query Account --output text 2>/dev/null))"
    return 0
  fi
  error_banner \
    "AWS credentials not valid for profile: agentobox" \
    "" \
    "Check ~/.aws/credentials has an [agentobox] section" \
    "with valid access keys for your personal account."
  return 1
}

# Run an AWS command using the agentobox profile, bypassing env var keys.
# Usage: abox_aws s3 ls
abox_aws() {
  env -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY \
    AWS_PROFILE=agentobox "$@"
}
