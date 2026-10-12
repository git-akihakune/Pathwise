#!/usr/bin/env bash
# Runs the Playwright suite against a fresh compose stack on port 3100.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=pathwise-e2e PATHWISE_PORT=3100 APP_URL=http://localhost:3100
dc() { docker compose --env-file /dev/null "$@"; }
trap 'dc down -v' EXIT

dc up -d --build --wait web worker
E2E_BASE_URL=http://localhost:3100 pnpm exec playwright test "$@"
