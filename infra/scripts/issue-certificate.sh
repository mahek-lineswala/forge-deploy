#!/usr/bin/env bash
# Issues the wildcard certificate (DEPLOYMENT_DOMAIN + *.DEPLOYMENT_DOMAIN) via
# Cloudflare DNS. Run once before the first `up`; the certbot service renews it.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

: "${DEPLOYMENT_DOMAIN:?set DEPLOYMENT_DOMAIN in infra/.env}"
: "${ACME_EMAIL:?set ACME_EMAIL in infra/.env}"
[ -f certbot/cloudflare.ini ] || { echo "Missing infra/certbot/cloudflare.ini (see cloudflare.ini.example)"; exit 1; }
chmod 600 certbot/cloudflare.ini

docker compose -f docker-compose.prod.yml --env-file .env run --rm --entrypoint certbot certbot \
  certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /run/secrets/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  -d "${DEPLOYMENT_DOMAIN}" \
  -d "*.${DEPLOYMENT_DOMAIN}" \
  --email "${ACME_EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --non-interactive

echo "Certificate issued for ${DEPLOYMENT_DOMAIN} and *.${DEPLOYMENT_DOMAIN}."
