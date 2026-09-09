#!/bin/zsh
set -euo pipefail

bridge_url="${RXT_BRIDGE_URL:-http://127.0.0.1:4319}"

health="$(curl -fsS --max-time 5 "$bridge_url/health")" || {
  echo "✗ llm-bridge is unavailable at $bridge_url"
  echo "  Start/restart it with: uid=\$(id -u); launchctl kickstart -k gui/\$uid/com.louis.llm-bridge"
  exit 1
}

echo "✓ llm-bridge health: $health"

completion="$(curl -fsS --max-time 90 "$bridge_url/complete" \
  -H 'content-type: application/json' \
  --data '{"system":"Return only the word OK.","prompt":"Health check.","json":false,"maxTokens":8}')" || {
  echo "✗ health endpoint works, but completion failed"
  exit 2
}

if [[ "$completion" == *"OK"* ]]; then
  echo "✓ completion test passed"
else
  echo "⚠ completion returned an unexpected response: $completion"
  exit 3
fi
