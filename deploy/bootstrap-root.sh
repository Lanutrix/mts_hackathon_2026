#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "$(hostname)" = ams-1-vm-5409
getent passwd deploy >/dev/null
test -s /home/deploy/.ssh/authorized_keys
umask 077
backup=/var/backups/watermelon-bootstrap-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.d "$backup/"
cp -a /etc/fstab "$backup/fstab"
ss -lnt > "$backup/listeners.txt"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql postgresql-contrib ca-certificates xz-utils ufw
temp=$(mktemp -d /var/tmp/watermelon-bootstrap.XXXXXX)
trap 'rm -f "$temp/node.tar.xz" "$temp/caddy.tar.gz"; rmdir "$temp" 2>/dev/null || true' EXIT
curl --fail --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/v24.18.0/node-v24.18.0-linux-x64.tar.xz -o "$temp/node.tar.xz"
printf '%s  %s\n' 55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742 "$temp/node.tar.xz" | sha256sum -c -
mkdir -p /opt/watermelon-node
tar -xJf "$temp/node.tar.xz" --strip-components=1 -C /opt/watermelon-node
curl --fail --location --proto '=https' --tlsv1.2 https://github.com/caddyserver/caddy/releases/download/v2.11.9/caddy_2.11.9_linux_amd64.tar.gz -o "$temp/caddy.tar.gz"
printf '%s  %s\n' 5b8cb7faf8726a2028ad96a66e54e6e81e8f361bc6175e5d22bbd997cc5177fb "$temp/caddy.tar.gz" | sha256sum -c -
tar -xzf "$temp/caddy.tar.gz" -C "$temp" caddy
install -m 0755 "$temp/caddy" /usr/local/bin/caddy
rm -f "$temp/caddy"
getent passwd caddy >/dev/null || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
install -d -m 0750 -o caddy -g caddy /var/lib/caddy /etc/caddy
install -d -m 0750 -o deploy -g deploy /srv/mts-watermelon/{releases,shared,backups}
install -d -m 0700 -o deploy -g deploy /srv/mts-watermelon/shared/{models,demo,workspace}
# 889 MiB VM: swap protects model loading; no existing swap is replaced.
if [ "$(swapon --noheadings | wc -l)" -eq 0 ] && [ ! -e /swapfile-watermelon ]; then
  fallocate -l 1G /swapfile-watermelon
  chmod 600 /swapfile-watermelon
  mkswap /swapfile-watermelon
  swapon /swapfile-watermelon
  printf '\n/swapfile-watermelon none swap sw 0 0\n' >> /etc/fstab
fi
systemctl enable --now postgresql
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='deploy'" | grep -q 1 || runuser -u postgres -- createuser --no-superuser --no-createdb --no-createrole deploy
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname='watermelon'" | grep -q 1 || runuser -u postgres -- createdb -O deploy watermelon
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET shared_buffers='64MB'" -c "ALTER SYSTEM SET max_connections='20'" -c "ALTER SYSTEM SET listen_addresses='127.0.0.1'"
systemctl restart postgresql
cat > /etc/mts-watermelon.env <<'ENV'
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
ORIGIN=https://mts-watermelon.ru
PUBLIC_DEMO=true
DATA_DIR=/srv/mts-watermelon/shared
USERS_FILE=/srv/mts-watermelon/shared/users.json
DATABASE_URL=postgresql://deploy@localhost/watermelon?host=/var/run/postgresql
AI_TIMEOUT_MS=120000
ENV
chown root:deploy /etc/mts-watermelon.env
chmod 0640 /etc/mts-watermelon.env
test -e /srv/mts-watermelon/shared/users.json || install -m 0600 -o deploy -g deploy /dev/null /srv/mts-watermelon/shared/users.json
if [ ! -s /srv/mts-watermelon/shared/users.json ]; then printf '[]\n' > /srv/mts-watermelon/shared/users.json; fi
cat > /etc/systemd/system/mts-watermelon.service <<'UNIT'
[Unit]
Description=Watermelon incident dashboard demo
After=network.target postgresql.service
Requires=postgresql.service
[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/srv/mts-watermelon/current
EnvironmentFile=/etc/mts-watermelon.env
Environment=PATH=/opt/watermelon-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/watermelon-node/bin/node --import tsx apps/server/main.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/srv/mts-watermelon/shared
MemoryHigh=600M
MemoryMax=750M
TasksMax=100
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/watermelon-caddy.service <<'UNIT'
[Unit]
Description=Watermelon HTTPS reverse proxy
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
Restart=on-failure
TimeoutStopSec=5s
LimitNOFILE=1048576
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/caddy
Environment=XDG_DATA_HOME=/var/lib/caddy/data
Environment=XDG_CONFIG_HOME=/var/lib/caddy/config
[Install]
WantedBy=multi-user.target
UNIT
# No ACME attempt before authoritative DNS is ready. No public password login over HTTP.
cat > /etc/caddy/Caddyfile <<'CADDY'
http://89.19.215.254 {
  @writes not method GET HEAD
  respond @writes "Предпросмотр доступен только для чтения. Для входа используйте HTTPS или SSH-туннель." 403
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
  header X-Content-Type-Options nosniff
}
CADDY
chown root:caddy /etc/caddy/Caddyfile
chmod 0640 /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
# Limited management actions for this app only, no general sudo.
cat > /etc/sudoers.d/watermelon-service <<'SUDO'
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mts-watermelon.service, /usr/bin/systemctl start mts-watermelon.service, /usr/bin/systemctl stop mts-watermelon.service
SUDO
chmod 0440 /etc/sudoers.d/watermelon-service
visudo -cf /etc/sudoers.d/watermelon-service
# Preserve provider monitoring (already exposed before this task); do not change its policy blindly.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 10050/tcp comment 'Existing provider monitoring; narrow only after provider confirms source'
ufw --force enable
systemctl enable mts-watermelon.service watermelon-caddy.service
systemctl start watermelon-caddy.service
printf 'BOOTSTRAP_OK\n'
/opt/watermelon-node/bin/node --version
caddy version
runuser -u deploy -- psql -d watermelon -tAc 'SELECT version()'
