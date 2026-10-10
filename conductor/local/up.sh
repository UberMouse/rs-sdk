#!/usr/bin/env bash
# Bring up the local stack (gateway :7780, engine :8888/:43594), building what's missing.
# Idempotent: anything already listening is left alone. Logs: conductor/runs/server/*.log
#
#   conductor/local/up.sh            # start
#   conductor/local/up.sh --rebuild  # re-pack content and rebuild the webclient first
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
LOGS="$ROOT/conductor/runs/server"
mkdir -p "$LOGS"

listening() { ss -ltn "sport = :$1" | grep -q LISTEN; }

# Always install: a merge that bumps a dependency (e.g. the runescript compiler) otherwise leaves
# a stale node_modules that fails the content pack. A no-op install takes milliseconds.
(cd "$ROOT" && bun install)
for d in gateway webclient engine; do
  (cd "$ROOT/server/$d" && bun install)
done
if [[ "${1:-}" == "--rebuild" || ! -d "$ROOT/server/webclient/out/bot" ]]; then
  echo "building webclient..."
  (cd "$ROOT/server/webclient" && bun run build) > "$LOGS/webclient-build.log" 2>&1
fi
if [[ "${1:-}" == "--rebuild" || ! -d "$ROOT/server/engine/data/pack" ]]; then
  echo "packing content..."
  (cd "$ROOT/server/engine" && BUILD_VERIFY=false bun run build) > "$LOGS/engine-build.log" 2>&1
fi
bun "$ROOT/conductor/local/migrate-sqlite.ts"

if listening 7780; then echo "gateway already up"; else
  (cd "$ROOT/server/gateway" && nohup bun run gateway.ts > "$LOGS/gateway.log" 2>&1 &)
  echo "gateway starting (log: $LOGS/gateway.log)"
fi
if listening 8888; then echo "engine already up"; else
  # The Grand Exchange is off locally so that .sav files are the only save store: while the GE
  # database (GE_DATABASE, default data/market.sqlite) exists the engine loads a player from its
  # checkpoint row instead of the .sav, which would undo save.ts restores.
  # See conductor/docs/parallel-bots.md.
  market="${GE_DATABASE:-data/market.sqlite}"
  [[ "$market" = /* ]] || market="$ROOT/server/engine/$market"
  if [[ -e "$market" ]]; then
    echo "refusing to start the engine: $market exists and would override .sav files." >&2
    echo "retire it (engine down): for f in $market{,-wal,-shm}; do [ -e \"\$f\" ] && mv \"\$f\" \"\$f.retired\"; done" >&2
    exit 1
  fi
  # SAVE_ENDPOINTS: GET /save and POST /kick on the management port, for save.ts and load.ts.
  (cd "$ROOT/server/engine" && GE_ENABLED=false SAVE_ENDPOINTS=true nohup bun run src/app.ts > "$LOGS/engine.log" 2>&1 &)
  echo "engine starting (log: $LOGS/engine.log)"
fi

for _ in $(seq 1 90); do
  listening 7780 && listening 8888 && break
  sleep 1
done
if listening 7780 && listening 8888; then
  echo "up: game http://localhost:8888  gateway ws://localhost:7780"
else
  echo "stack did not come up; see $LOGS" >&2
  exit 1
fi
