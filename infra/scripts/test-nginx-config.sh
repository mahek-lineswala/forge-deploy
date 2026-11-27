#!/usr/bin/env bash
# Validates the dev, prod and tunnel Nginx configs with the same image the stacks use.
# Usage: infra/scripts/test-nginx-config.sh   (needs Docker; used by CI)
set -euo pipefail

cd "$(dirname "$0")/.."
IMAGE=nginx:1.27-alpine
DOMAIN=example.com
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Throwaway certificate standing in for Let's Encrypt.
mkdir -p "$WORK/live/$DOMAIN" "$WORK/runtime/aliases"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$DOMAIN" \
  -keyout "$WORK/live/$DOMAIN/privkey.pem" -out "$WORK/live/$DOMAIN/fullchain.pem" 2>/dev/null

# One runtime route in the format the worker writes.
printf '# Managed by ForgeDeploy. Do not edit.\naaaaaaaaaaaaaaaaaaaaaaaa forgedeploy-runtime-test:3000;\n' > "$WORK/runtime/aaaaaaaaaaaaaaaaaaaaaaaa.map"

# One custom subdomain alias in the format the worker writes.
printf '# Managed by ForgeDeploy. Do not edit.\n"my-app.%s" aaaaaaaaaaaaaaaaaaaaaaaa;\n' "$DOMAIN" > "$WORK/runtime/aliases/my-app.alias"

for mode in dev prod tunnel; do
  echo "== nginx -t ($mode)"
  docker run --rm \
    -e DEPLOYMENT_DOMAIN="$([ "$mode" = dev ] && echo localhost || echo "$DOMAIN")" \
    -v "$PWD/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
    -v "$PWD/nginx/snippets:/etc/nginx/snippets:ro" \
    -v "$PWD/nginx/templates/$mode:/etc/nginx/templates:ro" \
    -v "$WORK/runtime:/etc/nginx/runtime:ro" \
    -v "$WORK:/etc/letsencrypt:ro" \
    "$IMAGE" /docker-entrypoint.sh nginx -t
done
