#!/usr/bin/env bash
# Creates the data folders the stack mounts. Run once on the VPS (as root or with sudo).
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a
: "${FORGEDEPLOY_DATA_DIR:?set FORGEDEPLOY_DATA_DIR in infra/.env}"

mkdir -p "${FORGEDEPLOY_DATA_DIR}"/{temp,logs,deployments,runtime-nginx,dashboard}
echo "Created ${FORGEDEPLOY_DATA_DIR}/{temp,logs,deployments,runtime-nginx,dashboard}"
