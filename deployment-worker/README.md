# ForgeDeploy deployment worker

Consumes deployment jobs from the BullMQ `deployments` queue and turns a GitHub
repository into a live site: a **static** deployment (files served by Nginx) or a
**runtime** deployment (a container behind Nginx, e.g. Next.js or Express).

## Pipeline

```text
job ─▶ worker.ts                claim MongoDB lease (renewed every 30 s), watch for cancel (5 s)
        └─ deployment.processor  one attempt, always cleans up its workspace
            1. clone.processor   shallow clone into temp/<deployment>/<attempt>
            2. build.processor   detect settings → sandboxed install/build in a Docker volume
            3a. static-deploy    export output → atomic publish → health check → READY
            3b. runtime-deploy   docker commit image → start container → Nginx route → health check → READY
```

Status flow: `QUEUED → CLONING → BUILDING → DEPLOYING → HEALTH_CHECK → READY`
(or `FAILED` / `CANCELLED` / `SUPERSEDED`). MongoDB is the source of truth; Redis
only carries jobs.

## Source layout

```text
src/
├── main.ts                     process entry: connect, start worker + janitor, graceful shutdown
├── worker.ts                   BullMQ job handler: lease, cancellation, retry decisions
├── config/env.ts               validated environment (.env)
├── constants/                  collection names, deployment status groups
├── lib/                        clients and low-level helpers (MongoDB, Redis, Docker CLI, decryption)
├── processors/                 pipeline stages (clone, build, static deploy, runtime deploy)
├── services/
│   ├── build/                  build settings detection, sandboxed Docker build
│   ├── deployment/             deployment state, logs, metadata in MongoDB
│   ├── hosting/                URLs, health checks, static publish, runtime containers, Nginx routes
│   ├── environment.service.ts  project environment variables
│   ├── github.service.ts       repository access for cloning
│   └── janitor.service.ts      cleanup of leftovers from crashed or finished attempts
├── types/                      MongoDB documents, build results
└── utils/                      errors, deployment ID validation
```

## Build sandbox

- Builds run in a per-attempt Docker volume (`forgedeploy-ws-*`), not on the host
  filesystem. This keeps `node_modules` off Windows bind mounts, which are slow and
  cannot represent its symlinks.
- Install runs with network access and a shared dependency cache volume
  (`forgedeploy-build-cache`). The build step runs with `--network none`, the cache
  read-only, and project env vars mounted read-only.
- Containers run as `BUILD_USER` (default `1000:1000`) with a read-only root
  filesystem, all capabilities dropped and CPU/memory/PID limits.
- Next.js projects keep `.next/cache` in a per-project volume between deployments.

## Hosting

Nginx serves every deployment at `<deploymentId>.<domain>` (config in `infra/nginx/`).
Static deployments are files in `DEPLOYMENTS_DIR/<id>`. Runtime deployments are
proxied to their container; the worker registers them as one-line map entries in
`RUNTIME_NGINX_DIR/<id>.map` (`<id> <container>:<port>;`) and reloads Nginx.
Route files from older worker versions (`<id>.conf`) are converted on startup.

Health checks request the deployment from Nginx with its `Host` header, at
`HEALTH_CHECK_URL` (production: the internal listener `http://nginx:8080`).

## Failure handling

- `NonRetryableError` (bad credentials, missing `package.json`, unsupported
  framework, …) fails the job immediately; other errors retry with backoff.
- Every state change is conditional on the attempt still owning the lease, so a
  stale attempt can never overwrite a newer one.
- The janitor runs at startup and every 15 minutes. Besides leftovers of crashed
  attempts, it removes files of failed, cancelled and superseded static deployments
  after `DEPLOYMENT_RETENTION_DAYS`.

## Commands

```bash
npm start            # run the worker (use this while deploying)
npm run dev          # watch mode: restarts on file save and kills in-flight builds
npm run typecheck    # tsc --noEmit
```

Development requires Docker, plus Redis and Nginx from `infra/docker-compose.yml`.
Copy `.env.example` to `.env` and use the same `DATABASE_URL`, `REDIS_URL` and
`ENCRYPTION_KEY` as the backend. Production runs the worker as a container from
`infra/docker-compose.prod.yml` (see `infra/README.md`).
