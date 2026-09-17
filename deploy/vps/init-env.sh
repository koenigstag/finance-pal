#!/usr/bin/env bash
# Finance Pal API: creates the service's env file with fresh secrets, or adds secrets a newer
# version of the API requires to an existing one. Never changes a value already there, so
# re-running is safe. Called by root-setup.sh and update.sh; no sudo needed.
#
# The database passwords are random hex (no characters that need escaping in a URL), generated
# here and never printed. root-setup.sh reads them from this file to create the roles.
set -euo pipefail

ENV_FILE="$HOME/.config/containers/env/finance-api.env"

mkdir -p "$(dirname "$ENV_FILE")"
umask 077

if [[ ! -e "$ENV_FILE" ]]; then
  api_password="$(openssl rand -hex 24)"
  user_password="$(openssl rand -hex 24)"

  cat >"$ENV_FILE" <<ENV
NODE_ENV=production
# Reachable only through nginx on this machine.
HOST=127.0.0.1
PORT=3002
# Runtime role: not the table owner, so row-level security applies to it.
DATABASE_URL=postgres://ft_user:${user_password}@127.0.0.1:5432/finance_tracker
# Schema owner for migrations; bypasses RLS on purpose.
MIGRATION_DATABASE_URL=postgres://ft_api:${api_password}@127.0.0.1:5432/finance_tracker
# The GitHub Pages site. Origins only, comma-separated, no paths.
CORS_ORIGINS=https://koenigstag.github.io
ENV
  echo "Created $ENV_FILE"
fi

# Secrets are appended only when missing: a key that already exists keeps its value, so
# sessions signed with it stay valid across deploys.
add_secret() {
  local name="$1" comment="$2"
  if ! grep -q "^${name}=" "$ENV_FILE"; then
    printf '# %s\n%s=%s\n' "$comment" "$name" "$(openssl rand -hex 48)" >>"$ENV_FILE"
    echo "Added $name to $ENV_FILE"
  fi
}

add_secret JWT_ACCESS_SECRET 'Signs access tokens.'
add_secret JWT_REFRESH_SECRET 'Signs refresh tokens; must differ from JWT_ACCESS_SECRET.'
