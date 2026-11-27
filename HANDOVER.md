# ForgeDeploy — Project Handover

**Updated:** 27 November 2026
**Status:** Static and runtime (Node.js/Express, Next.js SSR) deployments work end to end in development. A production stack for a single Linux VPS with HTTPS on a custom domain is implemented and validated, but has **not yet been run on a real VPS**. The production dashboard UI is still to be built.

**Stack:** Fastify + Prisma (backend), BullMQ worker, MongoDB Atlas, Redis, Docker, Nginx, Let's Encrypt via Cloudflare DNS, React + Vite + TanStack (frontend).

Status markers: **Verified** = run and confirmed by the developer. **Validated** = config/code tested in isolation (nginx -t with real routing tests, typecheck, build). **Not run** = implemented only.

---

## 1. Architecture

```text
Browser ─▶ nginx ──┬── app.<domain>/       dashboard (static)
                   ├── app.<domain>/api/*  backend (Fastify)  ──▶ MongoDB Atlas
                   └── <id>.<domain>       static files, or proxied runtime container
                                                    │
backend ──enqueue──▶ Redis/BullMQ ──▶ worker ──▶ Docker (builds, runtime containers, nginx reloads)
```

Deployment pipeline (worker): claim lease → clone → build in a Docker volume (install with
network, build without) → static: export + atomic publish / runtime: `docker commit` image +
container + Nginx map entry → health check through Nginx → `READY`, older deployments `SUPERSEDED`.

Details: `deployment-worker/README.md`, `infra/README.md`.

## 2. Repository

| Path | Contents |
|---|---|
| `backend/` | API, auth, projects, deployments, env vars, GitHub OAuth/webhooks, reconciler. `Dockerfile`. |
| `deployment-worker/` | Pipeline (`src/processors`), services grouped by `build/`, `deployment/`, `hosting/`. `Dockerfile`, `README.md`. |
| `frontend/` | Dashboard: sidebar layout, light/dark theme, heat-bar pipeline, project cards, grouped live build logs, env vars, GitHub import. Design tokens in `src/index.css`, shared components in `src/components/ui/`. |
| `infra/` | Dev, prod (VPS) and tunnel compose, Nginx (shared config, snippets, dev/prod/tunnel templates), scripts, runbook (`README.md`), daily commands (`OPERATIONS.md`). |
| `.github/workflows/ci.yml` | Typecheck/build all packages, Nginx config test, compose validation, image builds. |

## 3. Status

| Area | Status |
|---|---|
| Static deployments (Vite etc.) | Verified (dev) |
| Runtime: Express | Verified (dev) |
| Runtime: Next.js 15 SSR | Verified (dev): build 63 s, was 13 min |
| Volume-based builds, shared dependency cache, `.next/cache` reuse | Verified (dev) |
| Cancel, retries, non-retryable errors, leases, janitor, webhook outbox | Verified (dev) |
| Env vars injected into build (redacted in logs) and runtime | Verified (dev) |
| Domain-agnostic Nginx (dev + prod templates, map-based runtime routes) | Validated: routing tests for static, SPA, runtime, dashboard, API, HTTPS, redirects, unknown hosts, real IP |
| Production compose, Dockerfiles, TLS issuance/renewal | Validated (compose config, builds compile and load); **not run on a VPS** |
| Production dashboard UI | Redesigned (verified against a mock API in a real browser at desktop and mobile widths; not yet exercised against the live backend) |
| Cloudflare Tunnel mode (`docker-compose.tunnel.yml`) | **Running** at `app.shipnest.dpdns.org` on a Windows laptop (Docker Desktop); operating commands in `infra/OPERATIONS.md` |

## 4. Changes in the latest round

- **Bug fixes:** Docker output parsing uses stdout only where values are parsed (container ID); clone validation checks `package.json` in the project's `rootDir` (monorepos).
- **Nginx:** one shared config + dev/prod templates; `DEPLOYMENT_DOMAIN` instead of hardcoded `localhost`; runtime routes are `<id>.map` entries (`<id> <container>:<port>;`) used by a single deployment server; old `<id>.conf` route files are converted on worker start; backend and runtime upstreams resolved per request (a down container never stops Nginx).
- **Worker:** `HEALTH_CHECK_URL` (internal Nginx listener in prod), `DEPLOYMENT_RETENTION_DAYS` cleanup of retired static deployments, log rotation for runtime containers.
- **Backend:** `TRUST_PROXY`, `API_DOCS_ENABLED`, runtime fields (`deploymentType`, `startCommand`, `runtimePort`) in deployment responses.
- **Production:** `infra/docker-compose.prod.yml` (separate networks for apps vs internal services, Redis password, log limits), Dockerfiles, Cloudflare DNS wildcard certificate + auto renewal, `infra/README.md` runbook, CI.

## 5. Known gaps

| Gap | Impact |
|---|---|
| Worker has the Docker socket | Root-equivalent; fine for trusted users only |
| Build installs have internet and can reach the host's network | Malicious `postinstall` risk; trusted users only |
| No rollback / promote of older deployments | Retired deployments are kept `DEPLOYMENT_RETENTION_DAYS` for inspection only |
| Runtime logs (app stdout) not exposed in API/dashboard | Debug via `docker logs` |
| Runtime health check always requests `/` (2xx) | APIs without a `/` route fail; needs a per-project health path |
| Env vars not available during install | Private npm registries unsupported |
| No automated tests beyond typecheck/build/config checks | Races, cancellation, reconciler only tested by hand |
| Dashboard max 100 deployments per project, no pagination | Backend `take: 100` |
| `certbot/dns-cloudflare:latest` | Pin a version once deployed |

## 6. Next steps

1. Deploy to the VPS with `infra/README.md`; confirm HTTPS, a static deploy, a Next.js deploy, a GitHub push webhook.
2. Production dashboard (frontend).
3. Runtime logs + per-project health check path.
4. Automated integration tests for the worker.
5. Rollback/promote, deployment pagination.

## 7. Cautions

- Never commit `.env`, `.env.production`, `infra/.env`, `infra/certbot/cloudflare.ini`.
- `ENCRYPTION_KEY` must be identical in backend and worker; changing it makes stored GitHub tokens and env vars unreadable.
- Run the worker with `npm start` (not `npm run dev`) while deploying in development.
- Do not mark deployments `READY` manually; do not delete `temp/` or `deployments/` while the worker runs.
- After Prisma schema changes, run `npx prisma db push` (Atlas indexes) and `npx prisma generate`.
