#!/usr/bin/env bash
# Finance Pal API: creates the service's env file with fresh secrets if it doesn't exist yet.
# Never overwrites an existing one, so re-running is safe. Called by root-setup.sh and
# update.sh; no sudo needed.
#
# The database passwords are random hex (no characters that need escaping in a URL), generated
# here and never printed. root-setup.sh reads them from this file to create the roles.
set -euo pipefail

ENV_FILE="$HOME/.config/containers/env/finance-api.env"

if [[ -e "$ENV_FILE" ]]; then
  exit 0
fi

mkdir -p "$(dirname "$ENV_FILE")"
umask 077

api_password="$(openssl rand -hex 24)"
user_password="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -hex 48)"

cat >"$ENV_FILE" <<ENV
NODE_ENV=production
# Reachable only through nginx on this machine.
HOST=127.0.0.1
PORT=3002
# Runtime role: not the table owner, so row-level security applies to it.
DATABASE_URL=postgres://ft_user:${user_password}@127.0.0.1:5432/finance_tracker
# Schema owner for migrations; bypasses RLS on purpose.
MIGRATION_DATABASE_URL=postgres://ft_api:${api_password}@127.0.0.1:5432/finance_tracker
JWT_ACCESS_SECRET=${jwt_secret}
# The GitHub Pages site. Origins only, comma-separated, no paths.
CORS_ORIGINS=https://koenigstag.github.io
ENV

echo "Created $ENV_FILE"
