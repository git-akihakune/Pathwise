#!/usr/bin/env bash
# Verifies the spec 4.5 contract: a fresh `docker compose up` works with no .env and no manual steps.
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=pathwise-smoke
# --env-file /dev/null so a developer's .env can't mask the defaults.
dc() { docker compose --env-file /dev/null "$@"; }
trap 'dc down -v' EXIT

assert_init_ok() {
  local code
  code=$(docker inspect -f '{{.State.ExitCode}}' "$(dc ps -aq init)")
  [ "$code" = "0" ] || { echo "init exited with $code" >&2; exit 1; }
}

dc up -d --build --wait web worker
assert_init_ok
curl -fsS http://localhost:3000/api/health | grep -q '"ok"'

dc logs init | grep -q '"msg":"taxonomy imported"' || { echo "taxonomy was not imported" >&2; exit 1; }
occupations=$(dc exec -T postgres psql -U pathwise -d pathwise -tAc 'select count(*) from occupations')
[ "$occupations" -ge 1000 ] || { echo "expected >= 1000 occupations, got $occupations" >&2; exit 1; }

curl -fsS http://localhost:3000/sign-up | grep -q "Create the admin account"

init_started() { docker inspect -f '{{.State.StartedAt}}' "$(dc ps -aq init)"; }
init_first=$(init_started)

before=$(dc exec -T worker sh -c 'sha256sum /var/lib/pathwise/secrets/*')
dc up -d --wait web worker
assert_init_ok
[ "$(init_started)" != "$init_first" ] || { echo "init did not re-run on second up" >&2; exit 1; }
after=$(dc exec -T worker sh -c 'sha256sum /var/lib/pathwise/secrets/*')
[ "$(dc logs init | grep -c '"msg":"taxonomy imported"')" = 1 ] || { echo "taxonomy imported again on second up" >&2; exit 1; }
dc logs init | grep -q '"msg":"taxonomy up to date"' || { echo "second init did not report taxonomy up to date" >&2; exit 1; }
[ "$before" = "$after" ] || { echo "secrets changed across restarts" >&2; exit 1; }

# Compose v2 prints ":0" (exit 0) for an unpublished port, older versions fail.
published=$(dc port postgres 5432 2>/dev/null || true)
if [ -n "$published" ] && [ "$published" != ":0" ]; then
  echo "postgres port is published: $published" >&2
  exit 1
fi

echo "SMOKE OK"
