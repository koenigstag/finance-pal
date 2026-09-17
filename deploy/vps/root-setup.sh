#!/usr/bin/env bash
# Finance Pal API: the one-time steps on hetzner-vps that need root. Safe to re-run.
#
#   ssh -t hetzner-vps "sudo bash ~/services/finance-pal/deploy/vps/root-setup.sh"
#
# 1. PostgreSQL roles and database (libs/api/database/bootstrap.sql): ft_api owns the schema and
#    runs migrations, ft_user is the runtime role that row-level security applies to. Their
#    passwords come from the service's env file, created by init-env.sh if missing.
# 2. An nginx site for finance-api.tfc-russia.xyz proxying to the API on 127.0.0.1:3002, and a
#    certbot certificate once DNS points at this server. Renewal is certbot.timer's job, as for
#    every other certificate here; the script ends with a dry run to prove it covers this one.
set -euo pipefail

DOMAIN=finance-api.tfc-russia.xyz
PUBLIC_IP=91.99.91.3
APP_USER=koenigstag
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
ENV_FILE="$APP_HOME/.config/containers/env/finance-api.env"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi
cd /

# Inside the repository clone the bootstrap lives in the database lib; next to this script is
# the fallback for running it from a copied deploy directory.
BOOTSTRAP="$HERE/../../libs/api/database/bootstrap.sql"
[[ -e "$BOOTSTRAP" ]] || BOOTSTRAP="$HERE/bootstrap.sql"

echo "== Env file"
runuser -u "$APP_USER" -- bash "$HERE/init-env.sh"

# Pulls one password out of a postgres:// URL in the env file without echoing it anywhere.
password_from() {
  sed -n "s|^$1=postgres://[^:]*:\([^@]*\)@.*|\1|p" "$ENV_FILE"
}
api_password="$(password_from MIGRATION_DATABASE_URL)"
user_password="$(password_from DATABASE_URL)"
if [[ -z "$api_password" || -z "$user_password" ]]; then
  echo "Could not read database passwords from $ENV_FILE" >&2
  exit 1
fi

echo "== PostgreSQL roles and database"
# Passwords go in on stdin, not argv, so they never show up in the process list. The ALTER ROLE
# lines keep an existing role in step with the env file (bootstrap.sql only creates missing ones).
{
  printf "\\set api_password '%s'\n\\set user_password '%s'\n" "$api_password" "$user_password"
  cat "$BOOTSTRAP"
  printf "ALTER ROLE ft_api WITH LOGIN PASSWORD :'api_password';\n"
  printf "ALTER ROLE ft_user WITH LOGIN PASSWORD :'user_password';\n"
} | runuser -u postgres -- psql -X -q -v ON_ERROR_STOP=1 -d postgres

echo "== nginx site for $DOMAIN"
# Installed once: certbot later adds its TLS block to this same file.
if [[ ! -e /etc/nginx/sites-available/finance-api ]]; then
  install -m 644 "$HERE/nginx-finance-api.conf" /etc/nginx/sites-available/finance-api
fi
ln -sfn /etc/nginx/sites-available/finance-api /etc/nginx/sites-enabled/finance-api
nginx -t
systemctl reload nginx

echo "== TLS certificate"
resolved="$(getent ahostsv4 "$DOMAIN" | awk 'NR == 1 { print $1 }')"
if [[ "$resolved" != "$PUBLIC_IP" ]]; then
  echo "$DOMAIN resolves to '${resolved:-nothing}', not $PUBLIC_IP."
  echo "Add an A record for it, wait until it resolves, then run this script again."
  exit 0
fi
certbot --nginx -d "$DOMAIN" --redirect --non-interactive --keep-until-expiring

echo "== Certificate renewal"
systemctl is-enabled --quiet certbot.timer && systemctl is-active --quiet certbot.timer || {
  echo "certbot.timer is not enabled and active; enabling it."
  systemctl enable --now certbot.timer
}
certbot renew --cert-name "$DOMAIN" --dry-run

echo "Done: https://$DOMAIN answers 502 until the API runs (deploy/vps/update.sh)."
