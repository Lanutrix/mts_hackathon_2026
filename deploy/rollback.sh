#!/usr/bin/env bash
set -euo pipefail
test "$(id -un)" = deploy
release=${1:?PREVIOUS_COMMIT_SHA required}
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
base=/srv/mts-watermelon
target="$base/releases/$release"
test "$(realpath "$target")" = "$target"
test -s "$target/RELEASE"
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
sudo /usr/bin/systemctl restart mts-watermelon.service
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; then printf 'ROLLED_BACK %s\n' "$release"; exit 0; fi
  sleep 1
done
exit 1
