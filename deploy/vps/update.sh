#!/usr/bin/env bash
# Finance Pal API: deploy or update on hetzner-vps. No sudo needed; root-setup.sh must have run
# once (database roles, nginx, certificate).
#
#   bash ~/services/finance-pal/deploy/vps/update.sh
#
# Clones main with gh on the first run and fast-forwards it afterwards, installs and builds inside
# the same node image the service runs (argon2 is a native addon, so it must be built for that
# image), applies migrations, then installs and restarts the user unit and waits for the health
# route.
set -euo pipefail

REPO=koenigstag/finance-pal
APP_DIR="$HOME/services/finance-pal"
IMAGE=docker.io/library/node:22.22.3-bookworm
UNIT=container-finance-api.service
ENV_FILE="$HOME/.config/containers/env/finance-api.env"
CACHE="$HOME/.cache/finance-pal"
PORT=3002

if [[ ! -d "$APP_DIR/.git" ]]; then
  gh repo clone "$REPO" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
git -C "$APP_DIR" log -1 --format='Deploying %h %s'

bash "$APP_DIR/deploy/vps/init-env.sh"
mkdir -p "$CACHE/corepack"

in_node() {
  podman run --rm --network host \
    --env-file "$ENV_FILE" \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e NX_DAEMON=false \
    -e NX_NO_CLOUD=true \
    -v "$APP_DIR:$APP_DIR" -w "$APP_DIR" \
    -v "$CACHE/corepack:/root/.cache/node/corepack" \
    "$IMAGE" bash -c "corepack enable pnpm && $1"
}

# A clean dist: Nx's cache has served stale API builds in this repo before.
in_node "pnpm install --frozen-lockfile && rm -rf apps/api/dist && pnpm nx build api --skip-nx-cache"
in_node "pnpm run migrate"

mkdir -p "$HOME/.config/systemd/user"
install -m 644 "$APP_DIR/deploy/vps/$UNIT" "$HOME/.config/systemd/user/$UNIT"
systemctl --user daemon-reload
systemctl --user enable "$UNIT" >/dev/null 2>&1
systemctl --user restart "$UNIT"

# Keeps the push webhook that triggers these deploys in step with the repository.
bash "$APP_DIR/deploy/vps/install-deploy-hook.sh"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "API is up: https://finance-api.tfc-russia.xyz/api/health"
    exit 0
  fi
  sleep 2
done
echo "No answer on 127.0.0.1:$PORT. Logs: journalctl --user -u $UNIT -n 50" >&2
exit 1
