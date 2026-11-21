#!/usr/bin/env bash
set -euo pipefail
test "$(id -un)" = deploy
release=${1:?COMMIT_SHA required}
[[ "$release" =~ ^[0-9a-f]{40}$ ]]
base=/srv/mts-watermelon
target="$base/releases/$release"
test "$(realpath "$target")" = "$target"
test -s "$target/RELEASE"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$base/backups/$stamp"
umask 077
mkdir -p "$backup"
# Offline files and database form one checkpoint. No secret is printed.
sudo /usr/bin/systemctl stop mts-watermelon.service
pg_dump -d watermelon --format=custom --file="$backup/watermelon.dump"
tar -cf "$backup/sources.tar" -C "$base/shared" demo workspace users.json
previous=$(readlink -f "$base/current" || true)
if [ -n "$previous" ]; then printf '%s\n' "$previous" > "$backup/previous-release"; fi
ln -s "$target" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
sudo /usr/bin/systemctl start mts-watermelon.service
for attempt in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/health/ready >/dev/null; then printf 'ACTIVATED %s\n' "$release"; exit 0; fi
  sleep 1
done
if [ -n "$previous" ]; then
  ln -s "$previous" "$base/current.next"
  mv -Tf "$base/current.next" "$base/current"
  sudo /usr/bin/systemctl restart mts-watermelon.service
fi
printf 'Activation failed; previous application selected. Additive schema retained.\n' >&2
exit 1
