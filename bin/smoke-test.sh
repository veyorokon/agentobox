#!/usr/bin/env bash
# Post-deploy smoke test — verifies the deployed app is healthy.
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

# 4. Allauth config returns providers with client_ids (if any are configured)
config=$(curl -sS --max-time "$GRAPHQL_TIMEOUT_S" "$URL/_allauth/browser/v1/config")
providers_ok=$(echo "$config" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    providers = d['data']['socialaccount']['providers']
    if not providers:
        # No providers configured — not a failure, just skip
        print('true')
    else:
        # Every configured provider must have a non-empty client_id
        all_ok = all(p.get('client_id', '') != '' for p in providers)
        print('true' if all_ok else 'false')
except Exception:
    print('false')
" 2>/dev/null)
check "OAuth providers configured" "$providers_ok"

# 5. OAuth redirect works end-to-end (fetch CSRF cookie, then POST)
cookie_jar=$(mktemp)
curl -sS --max-time "$GRAPHQL_TIMEOUT_S" -o /dev/null -c "$cookie_jar" "$URL/_allauth/browser/v1/config"
csrf_token=$(grep csrftoken "$cookie_jar" 2>/dev/null | awk '{print $NF}')
redirect_status=$(curl -sS --max-time "$GRAPHQL_TIMEOUT_S" -o /dev/null -w '%{http_code}' \
  -X POST "$URL/_allauth/browser/v1/auth/provider/redirect" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H "X-CSRFToken: $csrf_token" \
  -H "Referer: $URL/" \
  -b "$cookie_jar" \
  -d 'provider=google&callback_url='"$URL"'/accounts/google/login/callback/&process=login')
rm -f "$cookie_jar"
check "OAuth redirect endpoint returns 302" "$([ "$redirect_status" = "302" ] && echo true || echo false)"

echo ""
if [ "$fail" -eq 0 ]; then
  echo "All smoke tests passed."
else
  echo "SMOKE TESTS FAILED"
  exit 1
fi
