# syntax=docker/dockerfile:1
# ForgeDeploy deployment worker. Built by infra/docker-compose.prod.yml.
#
# Runs as root because it drives the host's Docker daemon through the mounted
# socket (/var/run/docker.sock), which is root-equivalent anyway.

# ── Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

# ── Runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# git: cloning repositories. docker-cli: builds, runtime containers, Nginx reloads.
RUN apk add --no-cache git docker-cli

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["node", "dist/main.js"]
