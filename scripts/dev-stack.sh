#!/bin/sh
# Bring up a local Postgres + the built app, for driving the real thing.
# Idempotent: safe to re-run when either half has gone away.
set -e
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/var/lib/postgresql/partsdata
PORT="${PORT:-3100}"

if ! pg_isready -h /tmp -p 5433 >/dev/null 2>&1; then
  echo "starting postgres…"
  su postgres -c "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -o '-p 5433 -k /tmp' -l /tmp/pg.log start" >/dev/null 2>&1 || true
  sleep 3
fi
pg_isready -h /tmp -p 5433 >/dev/null 2>&1 && echo "postgres ready" || { echo "postgres FAILED"; tail -5 /tmp/pg.log; exit 1; }

kill -9 $(pgrep -f next-server) 2>/dev/null || true
sleep 1
set -a; . ./.env; set +a
setsid npx next start -p "$PORT" > /tmp/next.log 2>&1 < /dev/null &
sleep 3
for i in $(seq 1 20); do
  sleep 2
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/login")" = "200" ]; then
    echo "app ready on :$PORT"; exit 0
  fi
done
echo "app FAILED"; tail -5 /tmp/next.log; exit 1
