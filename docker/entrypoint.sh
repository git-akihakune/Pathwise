#!/bin/sh
set -e
case "${1:-}" in
  web) exec node /app/web/apps/web/server.js ;;
  worker | init) exec node /app/worker/main.js "$1" ;;
  pathwise) shift; exec node /app/worker/main.js pathwise "$@" ;;
  *) echo "usage: entrypoint.sh web | worker | init | pathwise <cli-args>" >&2; exit 2 ;;
esac
