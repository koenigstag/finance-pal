#!/usr/bin/env bash
# Finance Pal API: installs (or refreshes) the deploy webhook receiver as a user service. No sudo
# needed; root-setup.sh adds the nginx route to it. Safe to re-run: update.sh calls it on every
# deploy, and it restarts the receiver only when the receiver itself changed.
#
#   bash ~/services/finance-pal/deploy/vps/install-deploy-hook.sh
#
# The shared secret is generated here once and never printed. GitHub needs the same value in the
# webhook's settings; read it on the server when setting that up:
#
#   ssh hetzner-vps "grep ^DEPLOY_HOOK_SECRET= ~/.config/containers/env/finance-deploy-hook.env"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT=finance-deploy-hook.service
ENV_FILE="$HOME/.config/containers/env/finance-deploy-hook.env"
STAMP="$HOME/.cache/finance-pal/deploy-hook.sha256"

mkdir -p "$(dirname "$ENV_FILE")" "$(dirname "$STAMP")" "$HOME/.config/systemd/user"
if [[ ! -e "$ENV_FILE" ]]; then
  (
    umask 077
    printf 'DEPLOY_HOOK_SECRET=%s\n' "$(openssl rand -hex 32)" >"$ENV_FILE"
  )
  echo "Created $ENV_FILE"
fi

install -m 644 "$HERE/$UNIT" "$HOME/.config/systemd/user/$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null 2>&1

# Restart only when the receiver or its unit changed. Safe even mid-deploy: the deploy runs in its
# own transient unit, not as a child of the receiver.
current="$(cat "$HERE/deploy-hook.py" "$HERE/$UNIT" | sha256sum | cut -d' ' -f1)"
if [[ "$(cat "$STAMP" 2>/dev/null)" != "$current" ]] || ! systemctl --user is-active --quiet "$UNIT"; then
  systemctl --user restart "$UNIT"
  echo "$current" >"$STAMP"
  echo "Deploy hook (re)started"
fi
