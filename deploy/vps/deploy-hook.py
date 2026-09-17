#!/usr/bin/env python3
"""Finance Pal API: redeploys the backend when GitHub reports a push to main.

GitHub posts push events to https://finance-api.tfc-russia.xyz/hooks/deploy; nginx forwards them
here, to 127.0.0.1. A request is acted on only when all of these hold:

- its X-Hub-Signature-256 is the HMAC-SHA256 of the body under DEPLOY_HOOK_SECRET (anyone can
  reach the URL; only GitHub knows the secret);
- it's a push to refs/heads/main of DEPLOY_HOOK_REPOSITORY;
- it changes something the backend is built from. Web-only pushes are left to the Pages workflow.

The deploy itself (update.sh) runs as its own transient systemd user unit, not as a child of this
process: GitHub gives up on a delivery after 10 seconds, and a deploy must survive this service
restarting — which update.sh itself does when this file changes. flock keeps deploys one at a
time; a push arriving mid-deploy waits for it and then deploys the newest main.

Standard library only. Setting DEPLOY_HOOK_DRY_RUN=1 logs the deploy command instead of running it.
"""

import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get('DEPLOY_HOOK_SECRET', '').encode()
REPOSITORY = os.environ.get('DEPLOY_HOOK_REPOSITORY', 'koenigstag/finance-pal')
BRANCH_REF = 'refs/heads/main'
HOST = '127.0.0.1'
PORT = int(os.environ.get('DEPLOY_HOOK_PORT', '3003'))
PATH = '/hooks/deploy'
DRY_RUN = os.environ.get('DEPLOY_HOOK_DRY_RUN') == '1'

APP_DIR = os.path.expanduser(os.environ.get('DEPLOY_HOOK_APP_DIR', '~/services/finance-pal'))
UPDATE_SCRIPT = os.path.join(APP_DIR, 'deploy', 'vps', 'update.sh')
LOCK_FILE = os.path.expanduser('~/.cache/finance-pal/deploy.lock')

# GitHub caps webhook payloads at 25 MB.
MAX_BODY_BYTES = 25 * 1024 * 1024

# What the API image is built from. Anything else (apps/web, docs, the Pages workflow) doesn't
# change the backend.
BACKEND_PREFIXES = ('apps/api/', 'libs/', 'deploy/vps/')
BACKEND_FILES = {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'nx.json', 'tsconfig.base.json', '.nvmrc'}


def log(message):
    print(message, file=sys.stderr, flush=True)


def signature_is_valid(body, header):
    if not SECRET or not header or not header.startswith('sha256='):
        return False
    expected = 'sha256=' + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def changed_paths(payload):
    paths = set()
    for commit in payload.get('commits') or []:
        for key in ('added', 'modified', 'removed'):
            paths.update(commit.get(key) or [])
    return paths


def needs_backend_deploy(payload):
    # A force push can rewrite what's deployed without its new commits listing every file that
    # differs from before, so it always deploys.
    if payload.get('forced'):
        return True
    return any(path.startswith(BACKEND_PREFIXES) or path in BACKEND_FILES for path in changed_paths(payload))


def start_deploy(delivery_id):
    # Unit names allow a limited character set; a GitHub delivery id is a UUID, but don't trust it.
    # The timestamp keeps a redelivery (same id) from colliding with the original's unit.
    suffix = re.sub(r'[^A-Za-z0-9-]', '', delivery_id or '')[:8] or 'manual'
    unit = f'finance-api-deploy-{int(time.time())}-{suffix}'
    command = [
        'systemd-run', '--user', '--collect', f'--unit={unit}',
        '/usr/bin/flock', LOCK_FILE, '/bin/bash', UPDATE_SCRIPT,
    ]
    if DRY_RUN:
        log(f'dry run: {" ".join(command)}')
        return unit
    os.makedirs(os.path.dirname(LOCK_FILE), exist_ok=True)
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=10)
    return unit


class Handler(BaseHTTPRequestHandler):
    server_version = 'finance-deploy-hook'

    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.respond(405, {'error': 'POST only'})

    def do_POST(self):
        if self.path != PATH:
            self.respond(404, {'error': 'not found'})
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self.respond(413, {'error': 'bad length'})
            return
        body = self.rfile.read(length)

        # Before looking at anything else in the request: an unsigned body is noise.
        if not signature_is_valid(body, self.headers.get('X-Hub-Signature-256')):
            log('rejected: bad signature')
            self.respond(401, {'error': 'bad signature'})
            return

        event = self.headers.get('X-GitHub-Event')
        delivery = self.headers.get('X-GitHub-Delivery', '')
        if event == 'ping':
            self.respond(200, {'ok': True, 'event': 'ping'})
            return
        if event != 'push':
            self.respond(202, {'ignored': f'event {event}'})
            return

        try:
            payload = json.loads(body)
        except ValueError:
            self.respond(400, {'error': 'invalid JSON'})
            return

        repository = (payload.get('repository') or {}).get('full_name')
        ref = payload.get('ref')
        if repository != REPOSITORY or ref != BRANCH_REF or payload.get('deleted'):
            self.respond(202, {'ignored': f'{repository} {ref}'})
            return

        commit = (payload.get('after') or '')[:7]
        if not needs_backend_deploy(payload):
            log(f'{delivery}: {commit} has no backend changes')
            self.respond(202, {'ignored': 'no backend changes', 'commit': commit})
            return

        try:
            unit = start_deploy(delivery)
        except (subprocess.SubprocessError, OSError) as error:
            detail = getattr(error, 'stderr', '') or str(error)
            log(f'{delivery}: failed to start deploy of {commit}: {detail}')
            self.respond(500, {'error': 'could not start deploy'})
            return

        log(f'{delivery}: deploying {commit} as {unit}')
        self.respond(202, {'deploying': commit, 'unit': unit})

    # The default logs every request to stderr in Apache format; the lines above are enough.
    def log_message(self, format, *args):
        pass


def main():
    if not SECRET:
        log('DEPLOY_HOOK_SECRET is not set')
        sys.exit(1)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    log(f'listening on {HOST}:{PORT}{PATH} for pushes to {REPOSITORY} {BRANCH_REF}' + (' (dry run)' if DRY_RUN else ''))
    server.serve_forever()


if __name__ == '__main__':
    main()
