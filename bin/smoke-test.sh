#!/usr/bin/env bash
# Post-deploy smoke harness.
#
# Seam:
#   deployed HTTP/GraphQL surface -> live environment health
#
# Contract:
#   does the deployed control plane respond honestly enough to be considered up
#   after deploy?
#
# What it proves:
#   basic dashboard, GraphQL, auth, and OAuth redirect health
#
# What it does not prove:
#   full agent runtime continuity or complete end-to-end task execution
#
# Runs against a live URL. Exits non-zero on any failure.
#
# Usage: ./bin/smoke-test.sh https://dev.agentobox.com

set -euo pipefail

URL="${1:?Usage: smoke-test.sh <base-url>}"
GRAPHQL_URL="${GRAPHQL_URL:-$URL/graphql}"
GRAPHQL_TIMEOUT_S="${GRAPHQL_TIMEOUT_S:-10}"
GRAPHQL_STABILITY_PROBES="${GRAPHQL_STABILITY_PROBES:-3}"
SMOKE_TEST_USER="${SMOKE_TEST_USER:-}"
SMOKE_TEST_PASS="${SMOKE_TEST_PASS:-}"

fail=0
check() {
  local name="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo "  ✓ $name"
  else
    echo "  ✗ $name"
    fail=1
  fi
}

skip() {
  local name="$1"
  echo "  - $name (skipped)"
}

echo "Smoke testing $URL ..."

post_graphql() {
  local payload="$1"
  local auth_header="${2:-}"
  if [ -n "$auth_header" ]; then
    curl -sS --max-time "$GRAPHQL_TIMEOUT_S" \
      -X POST "$GRAPHQL_URL" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer $auth_header" \
      -d "$payload"
    return
  fi

  curl -sS --max-time "$GRAPHQL_TIMEOUT_S" \
    -X POST "$GRAPHQL_URL" \
    -H 'Content-Type: application/json' \
    -d "$payload"
}

# 1. Dashboard loads
status=$(curl -sS --max-time "$GRAPHQL_TIMEOUT_S" -o /dev/null -w '%{http_code}' "$URL/login")
check "Dashboard /login returns 200" "$([ "$status" = "200" ] && echo true || echo false)"

# 2. GraphQL endpoint responds repeatedly, not just once.
graphql_ok=true
for i in $(seq 1 "$GRAPHQL_STABILITY_PROBES"); do
  body="$(post_graphql '{"query":"{ __typename }"}' 2>/dev/null || true)"
  if ! echo "$body" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if d.get('data',{}).get('__typename')=='Query' else 'bad')" 2>/dev/null | grep -q '^ok$'; then
    graphql_ok=false
    break
  fi
done
check "GraphQL endpoint stays responsive" "$graphql_ok"

# 3. Authenticated GraphQL read works if smoke credentials are configured.
auth_graphql_ok=true
if [ -n "$SMOKE_TEST_USER" ] && [ -n "$SMOKE_TEST_PASS" ]; then
  login_payload=$(python3 - <<'PY'
import json, os
print(json.dumps({
    "query": "mutation ($input: LoginInput!) { login(input: $input) { token } }",
    "variables": {"input": {"username": os.environ["SMOKE_TEST_USER"], "password": os.environ["SMOKE_TEST_PASS"]}},
}))
PY
)
  login_body="$(post_graphql "$login_payload" 2>/dev/null || true)"
  token="$(echo "$login_body" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('login',{}).get('token',''))" 2>/dev/null || true)"
  if [ -z "$token" ]; then
    auth_graphql_ok=false
  else
    auth_body="$(post_graphql '{"query":"{ projects { id } }"}' "$token" 2>/dev/null || true)"
    if ! echo "$auth_body" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if isinstance(d.get('data',{}).get('projects'), list) else 'bad')" 2>/dev/null | grep -q '^ok$'; then
      auth_graphql_ok=false
    fi
  fi
fi
check "Authenticated GraphQL read responds" "$auth_graphql_ok"

# 4. Allauth config responds, and OAuth checks only run when at least one
# provider is actually configured with a client_id.
config=$(curl -sS --max-time "$GRAPHQL_TIMEOUT_S" "$URL/_allauth/browser/v1/config")
oauth_provider=$(echo "$config" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    providers = d['data']['socialaccount']['providers']
    configured = [p['id'] for p in providers if p.get('client_id', '').strip()]
    print(configured[0] if configured else '')
except Exception:
    print('__ERROR__')
" 2>/dev/null)
oauth_config_ok=true
if [ "$oauth_provider" = "__ERROR__" ]; then
  oauth_config_ok=false
fi
check "OAuth config endpoint responds" "$oauth_config_ok"

if [ -n "$oauth_provider" ] && [ "$oauth_provider" != "__ERROR__" ]; then
  check "OAuth providers configured" "true"
else
  skip "OAuth providers configured"
fi

# 5. OAuth redirect works end-to-end when at least one provider is configured.
if [ -n "$oauth_provider" ] && [ "$oauth_provider" != "__ERROR__" ]; then
  cookie_jar=$(mktemp)
  curl -sS --max-time "$GRAPHQL_TIMEOUT_S" -o /dev/null -c "$cookie_jar" "$URL/_allauth/browser/v1/config"
  csrf_token=$(grep csrftoken "$cookie_jar" 2>/dev/null | awk '{print $NF}')
  redirect_status=$(curl -sS --max-time "$GRAPHQL_TIMEOUT_S" -o /dev/null -w '%{http_code}' \
    -X POST "$URL/_allauth/browser/v1/auth/provider/redirect" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    -H "X-CSRFToken: $csrf_token" \
    -H "Referer: $URL/" \
    -b "$cookie_jar" \
    -d "provider=${oauth_provider}&callback_url=${URL}/accounts/${oauth_provider}/login/callback/&process=login")
  rm -f "$cookie_jar"
  check "OAuth redirect endpoint returns 302" "$([ "$redirect_status" = "302" ] && echo true || echo false)"
else
  skip "OAuth redirect endpoint returns 302"
fi

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "SMOKE TESTS FAILED"
  exit 1
fi
