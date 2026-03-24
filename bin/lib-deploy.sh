#!/usr/bin/env bash
# lib-deploy.sh — shared deploy shell functions
#
# Sourced by: .github/workflows/deploy-dev.yml, promote-prod.yml
# Contract: SSH retry with linear backoff, file upload via base64 encoding
#
# Callers must define $ssh_opts and $remote before sourcing.

set -euo pipefail

# Retry an SSH command up to 5 times with linear backoff (10s, 20s, ...).
# Usage: ssh_retry "remote command string"
ssh_retry() {
  local cmd="$1"
  local attempt delay
  for attempt in 1 2 3 4 5; do
    if ssh "${ssh_opts[@]}" "$remote" "$cmd"; then
      return 0
    fi
    delay=$((attempt * 10))
    echo "SSH attempt ${attempt} failed; retrying in ${delay}s..."
    sleep "${delay}"
  done
  echo "::error::SSH command failed after retries."
  return 1
}

# Upload a local text file to the remote host via base64 encoding.
# Usage: upload_text_file <local_path> <remote_path>
upload_text_file() {
  local local_path="$1"
  local remote_path="$2"

  if [[ ! -f "$local_path" ]]; then
    echo "::error::upload_text_file: local file not found: $local_path"
    return 1
  fi

  local payload
  payload="$(base64 < "$local_path" | tr -d '\n')"
  ssh_retry "mkdir -p \"$(dirname "$remote_path")\" && printf '%s' '$payload' | base64 -d > \"$remote_path\""
}
