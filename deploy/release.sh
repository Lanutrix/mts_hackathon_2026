#!/usr/bin/env bash
set -euo pipefail
test "$(id -un)" = deploy
release=${1:?Usage: release.sh COMMIT_SHA ARCHIVE}
archive=${2:?Archive required}
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
base=/srv/mts-watermelon
target="$base/releases/$release"
test ! -e "$target"
mkdir -m 750 "$target"
tar -xf "$archive" -C "$target" --no-same-owner
export PATH=/opt/watermelon-node/bin:$PATH
cd "$target"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
test -s dist/web/index.html
# Isolated staging: never run two writers against the production projection.
stage="$base/shared/staging-$release"
mkdir -m 700 "$stage"
DATA_DIR="$stage" DATABASE_URL= USERS_FILE= PORT=3001 NODE_ENV=development ORIGIN=http://127.0.0.1:3001 node --import tsx apps/server/main.ts > "$stage/server.log" 2>&1 &
stage_pid=$!
trap 'kill "$stage_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3001/health/ready > "$stage/health.json"; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:3001/health/ready >/dev/null
curl -fsS http://127.0.0.1:3001/api/dashboard > "$stage/dashboard.json"
node --input-type=module -e 'import fs from "node:fs";const d=JSON.parse(fs.readFileSync(process.argv[1]));if(d.total!==600||Object.keys(d.groups).length!==4)process.exit(1)' "$stage/dashboard.json"
kill "$stage_pid"
wait "$stage_pid" || true
trap - EXIT
printf '%s\n' "$release" > "$target/RELEASE"
printf 'STAGING_READY %s\n' "$release"
# Activation is a separate explicit command after browser/AI smoke through tunnel.
