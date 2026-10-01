#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:3001/health}"

curl -fsS "$API_URL" >/dev/null
