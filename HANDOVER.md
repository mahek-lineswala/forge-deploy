# ForgeDeploy — Project Handover

**Handover date:** 25 November 2026
**Previous handover:** 24 November 2026 (first end-to-end static deployment not yet working)
**Project status:** First end-to-end static deployments **work** (GitHub → clone → isolated Docker build → atomic publish → health check → served by Nginx). Reliability work, environment variables, log API and a first dashboard are done. Runtime (server) deployments, automated tests and production hardening remain.
**Environment:** Windows + PowerShell + VS Code. Repo at `C:\Users\Mahek\Desktop\forge-deploy` (no longer under OneDrive).
**Stack:** Node.js, TypeScript, Fastify, MongoDB Atlas, Prisma (backend), MongoDB driver (worker), Redis, BullMQ, Docker, Nginx, React + Vite + TanStack Router/Query + Tailwind (frontend).

Status markers used below:
- **Verified**: run on the developer's machine and confirmed working.
- **Smoke-tested**: verified only against a mock or in isolation.
- **Unverified**: implemented and typechecked, not yet confirmed by a real run.

---

## 1. Current architecture

```text
Dashboard (Vite :5173, proxies /api)          GitHub push webhook
              │                                        │
              ▼                                        ▼
        Fastify backend (:5000) ── MongoDB Atlas (source of truth)
              │   - creates Deployment (QUEUED)
              │   - reconciler re-enqueues QUEUED deployments with no job (every 60 s)
              ▼
        Redis (Docker, :6379) / BullMQ queue "deployments"  (jobId = deploymentId)
              │
              ▼
        Deployment worker
          claim Mongo lease (90 s, renewed every 30 s; cancel polled every 5 s)
          → CLONING     git clone --depth 1 (auth via http.extraheader)
          → BUILDING    container 1: install (network bridge)
                        container 2: build   (--network none, project env vars mounted read-only)
          → DEPLOYING   copy to .staging → atomic rename into deployments/<id>
          → HEALTH_CHECK  GET via Nginx with Host <id>.localhost
          → READY       older READY deployments of the project → SUPERSEDED
              │
              ▼
        Nginx (Docker, 127.0.0.1:8080)  serves http://<deploymentId>.localhost:8080
```

Key design decisions:
- **Subdomain per deployment** (`<id>.localhost:8080`), not `/<id>` paths, because Vite/CRA builds load assets from the site root (`/assets/...`).
- **Mongo is the outbox.** Every `QUEUED` deployment must have a BullMQ job; the backend reconciler repairs gaps. Job ID = deployment ID, so re-enqueueing cannot duplicate.
- **Non-retryable errors** (`NonRetryableError` → BullMQ `UnrecoverableError`) fail immediately; transient ones (Docker, network, lease, health check) use the 3 attempts / 95 s exponential backoff.

## 2. Repository layout

```text
forge-deploy/
├── HANDOVER.md
├── infra/
│   ├── docker-compose.yml         Redis + Nginx (both bound to 127.0.0.1)
│   └── nginx/nginx.conf           subdomain → /srv/deployments/<id>, SPA fallback
├── backend/                       Fastify API (unchanged structure, see §4)
│   └── src/modules/deployments/
│       ├── deployments.service.ts       duplicate guard, cancel (queued + running), logs
│       ├── deployments.reconciler.ts    NEW: outbox reconciler
│       └── ...
├── deployment-worker/
│   └── src/
│       ├── lib/encryption.ts            NEW: shared AES-256-GCM decrypt
│       ├── services/
│       │   ├── docker.service.ts        two-phase sandboxed build
│       │   ├── environment.service.ts   NEW: load/decrypt/redact project env vars
│       │   ├── health.service.ts        NEW: Nginx health probe
│       │   ├── janitor.service.ts       NEW: stale workspace/container cleanup
│       │   ├── publish.service.ts       NEW: atomic publish
│       │   ├── domain.service.ts        subdomain URLs
│       │   └── ...
│       └── utils/errors.ts              NonRetryableError
└── frontend/                      NEW: dashboard (React + Vite + TanStack)
```

`deployment-worker/src/utils/command.ts` and `logger.ts` are still empty placeholders.

## 3. Work completed in this session

### 3.1 Worker stabilization — Verified
- Confirmed all three fixes from the previous handover were applied: unique container names, lowercase framework matching, per-attempt workspace cleanup.
- Created the missing worker `.env` (it was absent; the worker could not start).
- Root cause of the first clone failure: the stored GitHub OAuth token had been **revoked** (GitHub returned 401 on `/user`). Fixed by reconnecting GitHub. Not a code bug.
- First successful end-to-end deployments: `6b051a96…87`, `6b051a98…88`.

### 3.2 Nginx static serving + health check — Verified
- `infra/nginx/nginx.conf`: regex `server_name` accepts only 24-char lowercase hex IDs (prevents path traversal), blocks dotfiles, `disable_symlinks on`, no autoindex, SPA fallback to `index.html`, immutable caching for `/assets/`, `no-cache` for HTML.
- Worker status flow is now `DEPLOYING → HEALTH_CHECK → READY`; READY only after Nginx returns 200 HTML (10 attempts, 1 s apart). `HEALTH_CHECK_ENABLED=false` skips it.

### 3.3 One live deployment per project — Verified
- Backend: `POST /projects/:id/deployments` returns **409** if the project already has a deployment in progress (10 s Redis lock closes the double-click race). Webhook path is not blocked.
- Worker: on publish, older `READY` deployments become `SUPERSEDED`; if a newer one is already READY, the late one supersedes itself.

### 3.4 Non-retryable failures — Verified
Bad/revoked token, repo or branch not found, missing `package.json` / build script / output directory, invalid JSON, undecryptable secret, unsupported framework, symlinks in output → fail on the first attempt. Git never prompts for credentials (`GIT_TERMINAL_PROMPT=0`).

### 3.5 Atomic publish + janitor — Verified
- Publish copies to `deployments/.staging/<id>-<attempt>`, then renames live → `.trash`, staging → live, deletes trash (rename retries for Windows locks). A failed attempt deletes published files only if it still owns the lease.
- Janitor (on worker start + every 15 min): removes `temp/<id>/<attempt>` older than 1 h unless that attempt holds a live lease, `.staging`/`.trash` leftovers older than 1 h, and `forgedeploy-build-*` containers older than build timeout + 5 min.

### 3.6 Deployment logs API — Verified
`GET /api/deployments/:id/logs?after=<cursor>&limit=200` → `{ logs, nextCursor, status, finished }`. Poll with `after=nextCursor` until `finished`.
Also fixed: the deployment response schema was stripping fields; `framework`, `packageManager`, `buildCommand`, `outputDir`, `buildDurationMs`, `errorMessage`, `attempts`, `startedAt`, `finishedAt` are now returned.

### 3.7 Webhook outbox — Verified (Redis-down path)
- Ignored events are filtered before any write. For real pushes, `GitHubWebhookDelivery` + `Deployment` are created in **one Mongo transaction** (requires a replica set; Atlas is one).
- An enqueue failure no longer marks the deployment FAILED; it stays `QUEUED` and the reconciler enqueues it.

### 3.8 Cancel running deployments — Verified
`POST /deployments/:id/cancel` works for `QUEUED`, `CLONING`, `BUILDING`, `DEPLOYING`, `HEALTH_CHECK`. The worker sees `CANCELLED` within ~5 s, aborts git/docker (container removed), does not retry, and deletes any published files.

### 3.9 Build sandbox hardening — Verified
Two containers per build: install with network, build with `--network none`. Both run as `BUILD_USER` (default `1000:1000`), `--read-only` root FS, `--init`, all capabilities dropped, `no-new-privileges`, 2 GB memory, 2 CPUs, 256 PIDs, 10-minute total timeout. npm/corepack caches live in the workspace so the offline build step can reuse them.

### 3.10 Project environment variables in builds — Verified
- Worker decrypts the project's `EnvironmentVariable` records (same `ENCRYPTION_KEY` as backend) and writes `export KEY='value'` lines (shell-quoted; newlines, `$`, quotes safe) to `temp/<id>/<attempt>.secrets/env.sh`, outside the workspace.
- Mounted read-only into the **build container only** (not install), sourced before the build command, deleted afterwards.
- Values of 6+ characters are redacted as `[KEY]` in persisted logs and errors. Reserved names (`PATH`, `HOME`, `COREPACK_HOME`, …) are skipped with a warning.
- Verified with `MY_SECRET`: logs showed `secret=[MY_SECRET]` and `len 14`.

### 3.11 Log stage labels — Unverified
Install output is now stored under `INSTALL`, build output under `BUILD`, health-check lines under `HEALTH_CHECK`. Committed; not yet confirmed in a real run.

### 3.12 Local infrastructure via Docker Compose — Verified
Redis moved from a native Windows process (PID was 30092) into `infra/docker-compose.yml` with an append-only volume. **Make sure the native Windows Redis stays stopped/disabled**, or two Redis servers may compete for port 6379.

### 3.13 Dashboard (`frontend/`) — Smoke-tested
React 19 + Vite 8 + TanStack Router (code-based routes) + TanStack Query + Tailwind v4. TypeScript 7 typecheck and production build pass. 11 flows passed in headless Chrome **against a mock API**; a run against the real backend has not been reported back.

| Route | Purpose |
|---|---|
| `/login`, `/register` | Auth. Access token in memory only; refresh via HTTP-only cookie; single-flight refresh on 401 |
| `/` | Project list |
| `/projects/new` | Pick GitHub repo → configure → optional immediate deploy |
| `/projects/$projectId?tab=deployments\|environment\|settings` | History (polls while active), env vars CRUD, settings + delete |
| `/deployments/$deploymentId` | Pipeline, metadata, error, live logs, Cancel / Visit |
| `/settings/integrations?github=success\|error` | GitHub connect/disconnect; backend OAuth callback redirects here |

Dev server proxies `/api` → `localhost:5000`, so `FRONTEND_URL` must stay `http://localhost:5173`.

## 4. API additions/changes since last handover

| Method | Path | Change |
|---|---|---|
| POST | `/api/projects/:projectId/deployments` | 409 when a deployment is already in progress |
| GET | `/api/deployments/:id` | Returns full build metadata (see §3.6) |
| GET | `/api/deployments/:id/logs` | **New** cursor-paginated logs |
| POST | `/api/deployments/:id/cancel` | Now also cancels running deployments |
| POST | `/api/github/webhook/:projectId` | Transactional delivery + deployment; enqueue failure leaves QUEUED |

No Prisma schema changes were made.

## 5. Configuration

Worker `.env` (copy secrets from `backend/.env`, never commit):

```env
NODE_ENV=development
REDIS_URL=redis://127.0.0.1:6379
DATABASE_URL=<same as backend>
MONGODB_DATABASE=forgedeploy
ENCRYPTION_KEY=<same as backend>
TEMP_DIR=./temp
LOG_DIR=./logs
DEPLOYMENTS_DIR=./deployments
MAX_CONCURRENT_DEPLOYMENTS=2
DEPLOYMENT_BASE_URL=http://localhost:8080   # URLs become http://<id>.localhost:8080
HEALTH_CHECK_ENABLED=true
BUILD_USER=1000:1000          # set "root" if Docker cannot write the bind mount
BUILD_NETWORK_ISOLATION=true  # false if a build step needs internet
```

Backend `.env` is unchanged. `HOST=0.0.0.0` exposes the API on the LAN; use `127.0.0.1` for local-only.

## 6. Running locally

```powershell
cd C:\Users\Mahek\Desktop\forge-deploy
docker compose -f infra/docker-compose.yml up -d     # Redis + Nginx
cd backend;            npm run dev                   # :5000, Swagger at /documentation
cd deployment-worker;  npm start                     # NOT "npm run dev" while deploying
cd frontend;           npm install; npm run dev      # :5173
```

`npm run dev` on the worker uses `tsx watch`; saving a file restarts the worker and kills in-flight builds (likely source of the earlier "stalled job" events).

Useful checks:

```powershell
docker exec forgedeploy-redis redis-cli ping
curl.exe http://127.0.0.1:8080/healthz
docker ps -a --filter "name=forgedeploy-build-"
```

## 7. Known issues and gaps

| Issue | Impact | Notes |
|---|---|---|
| Clone validation requires `package.json` at the **repo root** | Monorepos using `rootDir` (e.g. `apps/web`) fail | `clone.processor.ts` `isValidRepository`; should check `rootDir` after clone |
| Only static frameworks publish | Next.js SSR, Express, Python rejected | Phase D |
| GitHub cannot reach `localhost` webhooks | Push-to-deploy untestable locally | Needs a tunnel (e.g. cloudflared/ngrok) and `GITHUB_WEBHOOK_URL` update; dashboard has no webhook UI |
| Dashboard cannot be deployed on ForgeDeploy itself | It calls relative `/api`, Nginx has no API proxy | Add `VITE_API_URL` or an `/api` location |
| Superseded/failed deployments' files are never removed | `deployments/` grows forever; old URLs stay live | Retention policy needed |
| Install step has network access to LAN/host | A malicious `postinstall` can reach local services | Needs a dedicated Docker network with egress rules |
| Env vars not available during install | Private npm registries (`NPM_TOKEN`) unsupported | Opt-in install-time vars |
| Redaction skips values < 6 chars | Short secrets can appear in logs | Deliberate trade-off |
| Health check only checks `/` returns HTML | Broken JS/CSS still passes | Acceptable for now |
| Backend typechecked with TS 5 from this side | TS 7 run on Windows not confirmed | Run `npx tsc --noEmit` in `backend` |
| Single worker host assumption | `deployments/` is local disk; multiple worker machines would need shared/object storage | Production concern |
| Atlas connection blips | A query fails mid-attempt; job retries after 95 s | Observed once; transient |
| Dashboard lists max 100 deployments per project | No pagination | Backend `take: 100` |
| Earlier GitHub token died unexpectedly | Clones failed with 401 | Check whether `DELETE /api/github/connection` revokes the grant on GitHub |

## 8. Remaining work — recommended order

### Phase A' — Close out current work
1. Run the dashboard against the real backend; fix anything found.
2. Confirm log-stage labels (§3.11) in a real deployment.
3. Run backend `npx tsc --noEmit` with TS 7.
4. Fix the root `package.json` check for `rootDir` projects.

### Phase D — Runtime deployments (largest remaining feature)
- Detect runtime type (Next.js SSR, Node server, later Python).
- Long-running container per deployment with start command, port allocation, restart policy, resource limits.
- Nginx `proxy_pass` routing per subdomain (generated config or a small router).
- Runtime health checks; stop old containers when superseded.
- Runtime logs (stdout/stderr) in the dashboard.

### Phase F — Tests and CI
- Integration tests: lease races, retry/backoff, cancel during each stage, reconciler, supersede ordering, atomic publish failure, janitor safety.
- GitHub Actions: typecheck backend/worker/frontend, run tests.

### Phase G — Production readiness
- Real domain + wildcard TLS (`*.yourdomain`), `secure` cookies, `HOST=127.0.0.1` behind a reverse proxy.
- Egress-restricted install network; disk quotas per workspace; deployment retention/GC.
- Rate limits on deploy endpoints; per-user concurrency limits.
- Shared storage for published files if more than one worker host.
- Webhook management UI + public webhook URL; dashboard deployable with configurable API URL.
- Structured logging (`utils/logger.ts` is empty) and metrics.

## 9. Implementation cautions

- Do not mark deployments READY manually or bypass the health check.
- Do not delete `temp/` or `deployments/` wholesale while the worker runs; the janitor handles cleanup.
- Never put tokens in git URLs, logs or `.env.example`. Never log env var values.
- Keep builds inside the sandbox; do not run install/build on the host.
- Keep `jobId = deploymentId`; the reconciler relies on it for idempotency.
- Keep `NonRetryableError` for failures that cannot succeed on retry; do not use it for network/Docker errors.
- Webhook transactions require a Mongo replica set; a local standalone `mongod` will fail them.
- Run the worker with `npm start` when testing deployments.

## 10. Checkpoint

Last commit: `5496279 minimal frontend implementation`. Working tree clean at handover.

**Best next action:** start backend, worker and dashboard; import a repo and deploy through the dashboard; confirm logs show separate `INSTALL` / `BUILD` / `HEALTH_CHECK` stages. Then fix the `rootDir` clone check and begin Phase D.
