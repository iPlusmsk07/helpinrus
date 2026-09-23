#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

python3 -c 'import hashlib, sqlite3; assert hasattr(hashlib, "scrypt"), "hashlib.scrypt is unavailable"; sqlite3.connect(":memory:").execute("SELECT 1")'

repo=/opt/helpinrus
site_link=/etc/nginx/sites-enabled/helpinrus
snippet=/etc/nginx/snippets/helpinrus-auth-api.conf
environment=/etc/helpinrus/auth.env
auth_unit=/etc/systemd/system/helpinrus-auth.service
smtp_unit=/etc/systemd/system/helpinrus-auth-smtp-check.service
launcher=/usr/local/sbin/deploy-helpinrus
backup_dir=
service_was_active=0
service_was_enabled=0
committed=0

if [ ! -f "$repo/server/main.py" ]; then
  echo "Expected backend source at $repo/server/main.py" >&2
  exit 1
fi
if [ ! -f "$site_link" ]; then
  echo "Expected Nginx site at $site_link" >&2
  exit 1
fi
site=$(readlink -f "$site_link")
if [ ! -f "$site" ]; then
  echo "Nginx site link does not resolve to a regular file: $site_link" >&2
  exit 1
fi

backup_dir=$(mktemp -d /tmp/helpinrus-auth-install.XXXXXX)
cp -a "$site" "$backup_dir/site"
for entry in \
  "$snippet:snippet" \
  "$auth_unit:auth-unit" \
  "$smtp_unit:smtp-unit" \
  "$launcher:launcher"; do
  source_path=${entry%%:*}
  backup_name=${entry#*:}
  if [ -e "$source_path" ]; then
    cp -a "$source_path" "$backup_dir/$backup_name"
    : > "$backup_dir/$backup_name.existed"
  fi
done
if systemctl is-active --quiet helpinrus-auth.service; then
  service_was_active=1
fi
if systemctl is-enabled --quiet helpinrus-auth.service; then
  service_was_enabled=1
fi

restore_file() {
  local destination=$1
  local backup_name=$2
  if [ -f "$backup_dir/$backup_name.existed" ]; then
    cp -a "$backup_dir/$backup_name" "$destination"
  else
    rm -f -- "$destination"
  fi
}

cleanup_backup() {
  if [ -n "$backup_dir" ]; then
    case "$backup_dir" in
      /tmp/helpinrus-auth-install.*) rm -rf -- "$backup_dir" ;;
    esac
  fi
}

rollback_install() {
  local status=$1
  trap - ERR INT TERM
  set +e
  if [ "$committed" -ne 1 ]; then
    cp -a "$backup_dir/site" "$site"
    restore_file "$snippet" snippet
    restore_file "$auth_unit" auth-unit
    restore_file "$smtp_unit" smtp-unit
    restore_file "$launcher" launcher
    systemctl daemon-reload
    if [ "$service_was_enabled" -eq 1 ]; then
      systemctl enable helpinrus-auth.service >/dev/null 2>&1 || true
    else
      systemctl disable helpinrus-auth.service >/dev/null 2>&1 || true
    fi
    if [ "$service_was_active" -eq 1 ]; then
      systemctl restart helpinrus-auth.service || true
    else
      systemctl stop helpinrus-auth.service || true
    fi
    nginx -t && systemctl reload nginx || true
    echo "Installation failed; restored the previous Nginx site, auth snippet, units, launcher, and service state." >&2
  fi
  cleanup_backup
  exit "$status"
}

trap 'rollback_install $?' ERR
trap 'rollback_install 130' INT
trap 'rollback_install 143' TERM

if ! id helpinrus >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/helpinrus --shell /usr/sbin/nologin helpinrus
fi
install -d -m 0750 -o root -g helpinrus /etc/helpinrus
install -d -m 0700 -o helpinrus -g helpinrus /var/lib/helpinrus

if [ ! -f "$environment" ]; then
  install -m 0640 -o root -g helpinrus "$repo/ops/helpinrus-auth.env.example" "$environment"
  secret=$(openssl rand -hex 32)
  sed -i "s/^APP_SECRET=$/APP_SECRET=$secret/" "$environment"
  unset secret
fi

install -m 0644 "$repo/ops/helpinrus-auth.service" "$auth_unit"
install -m 0644 "$repo/ops/helpinrus-auth-smtp-check.service" "$smtp_unit"
install -m 0644 "$repo/ops/nginx-helpinrus-auth-api.conf" "$snippet"
install -m 0755 "$repo/ops/deploy-helpinrus-launcher" "$launcher"

python3 "$repo/ops/patch_nginx.py" "$site"
nginx -t

systemctl daemon-reload
systemctl enable helpinrus-auth.service
systemctl restart helpinrus-auth.service
systemctl reload nginx

# systemd can report the unit as started just before the Python listener begins
# accepting connections. Give the freshly installed API a bounded readiness
# window instead of rolling the entire installation back on that normal race.
health=
for attempt in 1 2 3 4 5; do
  health=$(curl --fail --silent \
    --connect-timeout 2 --max-time 5 \
    http://127.0.0.1:8787/api/auth/health || true)
  case "$health" in
    *'"status":"ok"'*'"database":"ok"'*) break ;;
  esac
  if [ "$attempt" -eq 5 ]; then
    systemctl status --no-pager helpinrus-auth.service >&2 || true
    echo "Auth API did not become ready: $health" >&2
    exit 1
  fi
  sleep 1
done
printf '%s\n' "$health"

committed=1
trap - ERR INT TERM
cleanup_backup
echo "Auth API installed. Configure SMTP in $environment before the next static production cutover."
