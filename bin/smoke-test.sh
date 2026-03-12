#!/usr/bin/env bash
# Post-deploy smoke test — verifies the deployed app is healthy.
# Runs against a live URL. Exits non-zero on any failure.
#
# Usage: ./bin/smoke-test.sh https://dev.agentobox.com

set -euo pipefail

URL="${1:?Usage: smoke-test.sh <base-url>}"

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

# 1. Dashboard loads
status=$(curl -s -o /dev/null -w '%{http_code}' "$URL/login")
check "Dashboard /login returns 200" "$([ "$status" = "200" ] && echo true || echo false)"

# 2. GraphQL endpoint responds
gql_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/graphql" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ __typename }"}')
check "GraphQL endpoint responds" "$([ "$gql_status" = "200" ] && echo true || echo false)"

# 3. Allauth config returns providers with client_ids
config=$(curl -s "$URL/_allauth/browser/v1/config")
providers_ok=$(echo "$config" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    providers = d['data']['socialaccount']['providers']
    # Every provider must have a non-empty client_id
    all_ok = all(p.get('client_id', '') != '' for p in providers)
    has_google = any(p['id'] == 'google' for p in providers)
    has_github = any(p['id'] == 'github' for p in providers)
    print('true' if (all_ok and has_google and has_github) else 'false')
except Exception:
    print('false')
" 2>/dev/null)
check "OAuth providers configured (Google + GitHub)" "$providers_ok"

# 4. OAuth redirect works end-to-end (fetch CSRF cookie, then POST)
cookie_jar=$(mktemp)
curl -s -o /dev/null -c "$cookie_jar" "$URL/_allauth/browser/v1/config"
csrf_token=$(grep csrftoken "$cookie_jar" 2>/dev/null | awk '{print $NF}')
redirect_status=$(curl -s -o /dev/null -w '%{http_code}' \
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
