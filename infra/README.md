# ForgeDeploy infrastructure

| File | Use |
|---|---|
| `docker-compose.yml` | Development: Redis + Nginx on `127.0.0.1`. Backend and worker run on your machine. |
| `docker-compose.prod.yml` | Production on one Linux VPS: everything in containers, HTTPS. |
| `docker-compose.tunnel.yml` | Same stack on any machine (laptop, home server) behind a Cloudflare Tunnel: no public IP, no open ports. |
| `nginx/` | Shared Nginx config, plus `templates/dev`, `templates/prod` and `templates/tunnel`. |
| `OPERATIONS.md` | Daily commands: start, update, logs, restart, backups, troubleshooting (tunnel setup). |
| `scripts/` | `prepare-host.sh` (data folders), `issue-certificate.sh` (first certificate). |

## Production architecture

```text
Internet ──▶ :80/:443 nginx ──┬── app.<domain>/       dashboard (static files)
                               ├── app.<domain>/api/*  ──▶ backend:5000
                               └── <id>.<domain>       static files, or ──▶ runtime container
                                   :8080 (internal)    same sites over HTTP, for worker health checks

network forgedeploy-internal:  nginx, backend, worker, redis, certbot
network forgedeploy-apps:      nginx + runtime deployment containers (cannot reach Redis or the API)

worker ──▶ /var/run/docker.sock  (builds, runtime containers, Nginx reloads)
MongoDB: Atlas.   TLS: Let's Encrypt wildcard via Cloudflare DNS, renewed by the certbot service.
```

## 1. Prerequisites

- **VPS:** Ubuntu 22.04/24.04, at least 2 vCPU, 4 GB RAM (8 GB recommended for Next.js builds), 40 GB disk.
- **Domain on Cloudflare.** Deployments get `<id>.<domain>`, the dashboard and API `app.<domain>`.
- **MongoDB Atlas** cluster (the same database the backend already uses is fine).
- **GitHub OAuth app.**

### DNS (Cloudflare → your domain → DNS)

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `@` (or your subdomain) | VPS IPv4 | DNS only |
| A | `*` (or `*.subdomain`) | VPS IPv4 | DNS only |

"DNS only" (grey cloud) is the simplest setup. Cloudflare's proxy (orange cloud) also
works if `DEPLOYMENT_DOMAIN` is the apex (`example.com`); set SSL/TLS mode to
**Full (strict)**. Proxying a deeper wildcard such as `*.apps.example.com` needs a paid
Cloudflare Advanced Certificate. Visitor IPs are restored automatically in both cases.

### Cloudflare API token

My Profile → API Tokens → Create Token → template **Edit zone DNS** → Zone Resources:
your domain. Certbot uses it only to create the `_acme-challenge` TXT record.

### Atlas

Network Access → add the VPS's public IP.

### GitHub OAuth app

GitHub → Settings → Developer settings → OAuth Apps:

- Homepage URL: `https://app.<domain>`
- Authorization callback URL: `https://app.<domain>/api/github/callback`

## 2. Install

```bash
# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sudo sh

sudo git clone <your-repo-url> /opt/forgedeploy
cd /opt/forgedeploy

# Settings and secrets (none of these files are committed)
cp infra/.env.example infra/.env                                   # domain, email, data dir, Redis password
cp infra/certbot/cloudflare.ini.example infra/certbot/cloudflare.ini   # Cloudflare token
cp backend/.env.production.example backend/.env.production         # Atlas URL, JWT secret, encryption key, GitHub app
cp deployment-worker/.env.production.example deployment-worker/.env.production   # Atlas URL, same encryption key
```

Generate secrets with `openssl rand -hex 32` (Redis password, `ENCRYPTION_KEY`) and
`openssl rand -hex 48` (`JWT_SECRET`). `ENCRYPTION_KEY` must be identical in the backend
and worker files. If you are moving from your development database, reuse its existing
key: stored GitHub tokens and environment variables are encrypted with it.

```bash
sudo infra/scripts/prepare-host.sh          # creates /srv/forgedeploy/{temp,logs,deployments,runtime-nginx,dashboard}
sudo infra/scripts/issue-certificate.sh     # wildcard certificate (once)
sudo docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build
```

## 3. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Only Nginx publishes ports. Docker-published ports bypass ufw, which is why nothing else is published.

## 4. Verify

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env ps     # all running, redis healthy
curl -s https://app.<domain>/api/health                                     # API through Nginx
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env logs -f worker
```

Then build the dashboard (section 5), log in at `https://app.<domain>`, connect GitHub
under **Integrations**, deploy a project and open `https://<deploymentId>.<domain>`.

## 5. Dashboard

The dashboard is served from `/srv/forgedeploy/dashboard`. Until the production
frontend is ready, `app.<domain>` shows an empty page; the API works regardless.

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env --profile tools run --rm dashboard-build
```

(This builds `frontend/` in a throwaway Node container and publishes it; no Node install is needed on the host.)

## 6. Operations

| Task | Command |
|---|---|
| Update | `git pull && docker compose -f infra/docker-compose.prod.yml --env-file infra/.env up -d --build` |
| Logs | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env logs -f <service>` |
| Restart one service | `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env restart <service>` |
| Prisma schema change | From your machine: `npx prisma db push` with the production `DATABASE_URL` |
| Certificate renewal | Automatic (certbot every 12 h, Nginx reloads every 6 h) |

### Backups

- **MongoDB:** Atlas backups (the source of truth for users, projects, deployments, logs).
- **Secrets:** `infra/.env`, `backend/.env.production`, `deployment-worker/.env.production`, `infra/certbot/cloudflare.ini`.
- Published sites, runtime images and the Redis queue can be rebuilt by redeploying.

## 7. Security notes

- The worker mounts the Docker socket, which is root-equivalent on the host. This setup
  is meant for trusted users; untrusted code needs a separate build host or a stronger
  sandbox (gVisor, Kata, Firecracker).
- Build installs have internet access; build scripts run with `--network none`.
- Runtime apps share the `forgedeploy-apps` network with Nginx only.
- Redis requires a password and is not published; the Swagger UI is disabled
  (`API_DOCS_ENABLED=false`).
- Containers and runtime apps have log rotation (10 MB × 3).

## 8. Troubleshooting

| Symptom | Cause |
|---|---|
| Nginx restarts in a loop, "cannot load certificate" | Run `infra/scripts/issue-certificate.sh` first |
| Certificate issuance fails | Token lacks Zone → DNS → Edit, or the domain is not on that Cloudflare account |
| Deployment stuck in `HEALTH_CHECK` then fails | `docker logs forgedeploy-nginx`; runtime: `docker logs forgedeploy-runtime-<id>-…` |
| `502` on a runtime deployment | Its container stopped: `docker ps -a --filter name=forgedeploy-runtime-<id>` |
| Clone fails with authentication errors | Reconnect GitHub; the stored token was revoked |
| GitHub login redirects to the wrong host | OAuth app callback URL must be `https://app.<domain>/api/github/callback` |

## 9. Run it on your own machine (Cloudflare Tunnel)

For a laptop or home server with no public IP. `cloudflared` opens an outbound connection to
Cloudflare, which forwards `app.<domain>` and `*.<domain>` to Nginx. Cloudflare provides the
HTTPS certificate, so there is no certbot, no `cloudflare.ini` and no open port.

The machine must stay on for the sites to be reachable. Setup is the same as sections 1-6,
with these differences:

1. **Domain:** add it to Cloudflare (Free plan) and wait until it shows **Active**.
   Wildcards work on the free plan only one level deep: `<id>.<domain>` and `app.<domain>`.
2. **Settings:** `cp infra/.env.example infra/.env` (`ACME_EMAIL` is unused). On Docker
   Desktop (Windows/macOS) keep `FORGEDEPLOY_DATA_DIR=/srv/forgedeploy`: it is a folder inside
   Docker's Linux VM, used consistently by every container.
3. **Create the tunnel** (run from the repository root; `tunnel login` prints a URL, open it,
   pick your domain and authorize):

   ```bash
   mkdir -p infra/cloudflared
   docker run --rm -it -v "$PWD/infra/cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel login
   docker run --rm -it -v "$PWD/infra/cloudflared:/home/nonroot/.cloudflared" cloudflare/cloudflared:latest tunnel create forgedeploy
   ```

   This writes `cert.pem` and `<TUNNEL_ID>.json` into `infra/cloudflared/` (both are git-ignored).
   Copy `infra/cloudflared/config.yml.example` to `config.yml` and replace `<TUNNEL_ID>`
   and `example.com`.
4. **DNS** (Cloudflare → your domain → DNS): two `CNAME` records, both **Proxied** (orange cloud):

   | Name | Target |
   |---|---|
   | `@` | `<TUNNEL_ID>.cfargotunnel.com` |
   | `*` | `<TUNNEL_ID>.cfargotunnel.com` |

   Under SSL/TLS, set the mode to **Full** and turn on **Always Use HTTPS**.
5. **Start** (no `prepare-host.sh` or `issue-certificate.sh` needed):

   ```bash
   docker compose -f infra/docker-compose.tunnel.yml --env-file infra/.env up -d --build
   ```

6. **Dashboard:** `docker compose -f infra/docker-compose.tunnel.yml --env-file infra/.env --profile tools run --rm dashboard-build`
7. **MongoDB Atlas:** allow your current public IP (or `0.0.0.0/0` for a home connection
   whose IP changes; the database user's password is then the only protection).

Verify with `curl -s https://app.<domain>/api/health`. Updating and logs work as in section 6,
with `docker-compose.tunnel.yml` instead of the prod file.

On Windows keep Docker Desktop running (enable *Start Docker Desktop when you sign in*) and
prevent the machine from sleeping while it should serve traffic.
