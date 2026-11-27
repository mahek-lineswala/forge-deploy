# Operating ForgeDeploy

Commands for the **tunnel setup** (Docker Desktop on Windows, PowerShell, run from the repository root).
Production lives at `https://app.shipnest.dpdns.org`.

```powershell
cd C:\Users\Mahek\Desktop\forge-deploy
```

Shorthand used below. Paste it once per PowerShell window:

```powershell
$env:COMPOSE_FILE = "infra/docker-compose.tunnel.yml"
```

With that set, `docker compose <command>` replaces
`docker compose -f infra/docker-compose.tunnel.yml --env-file infra/.env <command>`.

## 1. Every time you start your laptop

All services use `restart: unless-stopped`, so **Docker brings them back by itself**. Normally
nothing needs typing. Check that it happened:

```powershell
docker compose ps                                   # redis healthy, the rest "running"
curl.exe -s https://app.shipnest.dpdns.org/api/health
```

If Docker Desktop is not running yet, open it and wait for the whale icon to settle, then run the checks.

If `ps` shows nothing (you stopped the stack earlier with `down`), start it:

```powershell
docker compose up -d
```

### One-time laptop settings (so it stays reachable)

- Docker Desktop → Settings → General → **Start Docker Desktop when you sign in**.
- Keep it from sleeping while plugged in:
  ```powershell
  powercfg /change standby-timeout-ac 0
  ```
  Also set "When I close the lid" to **Do nothing** (Control Panel → Power Options) if you close the lid.
- Sites are offline whenever the laptop is off, asleep or without internet.

## 2. First start or after changing code

```powershell
git pull
docker compose up -d --build          # rebuilds backend and worker images, keeps data
```

Rebuild the dashboard after frontend changes (also needed once on a fresh machine):

```powershell
docker compose --profile tools run --rm dashboard-build
```

If you changed `backend/prisma/schema.prisma`, push the schema to Atlas from your machine
(set `DATABASE_URL` to the production URL first):

```powershell
cd backend
npx prisma db push
cd ..
```

If you changed anything under `infra/nginx/` (for example the custom-subdomain support), recreate Nginx.
A plain reload can keep reading a stale copy of the mounted file on Docker Desktop:

```powershell
docker compose up -d --force-recreate nginx
```

### Deleting things and custom subdomains

- **Delete a deployment** (deployment page → Delete) and **delete a project** (Settings → Delete project) take the
  site offline within seconds. The worker removes the Nginx route, the container and image, the published files and
  the build leftovers. If the worker was down, it finishes the job when it starts, and the janitor repairs anything
  missed every 15 minutes. Watch it with `docker compose logs -f worker`.
- **Custom subdomain** (project Settings → Domain): `<name>.<your domain>` always serves the latest successful
  deployment. It works through `*.<your domain>`, which Cloudflare's tunnel and certificate already cover.
- **Auto-deploy** (project Settings → Auto-deploy) adds a push webhook to the GitHub repository. It needs
  `https://app.<your domain>` to be reachable, which the tunnel provides.

## 3. Daily checks

```powershell
docker compose ps
docker compose logs --tail 50 worker
docker compose logs --tail 50 backend
docker compose logs --tail 20 cloudflared        # "Registered tunnel connection" x4 = healthy
```

Follow live logs: `docker compose logs -f worker` (Ctrl+C to stop following).

## 4. Restart or stop

```powershell
docker compose restart worker          # one service
docker compose restart                 # everything
docker compose stop                    # stop, containers stay (Docker restarts them with Docker Desktop)
docker compose down                    # stop and remove containers (data volumes are kept)
```

Never run `docker compose down -v`: it deletes volumes, including the build cache and Redis queue.

## 5. Developing locally (instead of production)

The dev setup uses the same container names, so stop production first:

```powershell
docker compose down
$env:COMPOSE_FILE = ""                                   # back to explicit -f for dev
docker compose -f infra/docker-compose.yml up -d         # dev Redis + Nginx
cd backend;           npm run dev                        # terminal 2
cd deployment-worker; npm start                          # terminal 3
cd frontend;          npm install; npm run dev           # terminal 4 -> http://localhost:5173
```

Switch back to production: stop the dev processes, `docker compose -f infra/docker-compose.yml down`,
set `$env:COMPOSE_FILE` again and `docker compose up -d`.

## 6. Housekeeping

```powershell
docker system df                       # what Docker uses on disk
docker image prune -f                  # dangling images from rebuilds
docker builder prune -f                # old build cache
```

The worker's janitor already removes retired deployments' images and files. Do not prune volumes:
`forgedeploy-build-cache` makes builds fast.

## 7. Backups

Users, projects and deployment history live in MongoDB Atlas (use its backups). Keep a private copy of
these secret files, none of which are in git:

- `infra/.env`
- `infra/cloudflared/config.yml` and `infra/cloudflared/<TUNNEL_ID>.json`
- `backend/.env.production`
- `deployment-worker/.env.production`

## 8. Troubleshooting

| Symptom | Check |
|---|---|
| Site shows Cloudflare error 1033 / 502 | `docker compose logs cloudflared`; is Docker Desktop running? If the log repeats "QUIC … no recent network activity", the tunnel must use TCP: the compose file already sets `--protocol http2`. After laptop sleep or a Wi-Fi change, `docker compose restart cloudflared` reconnects at once. |
| Page loads but login or API fails | `docker compose logs backend`; Atlas IP allow-list (your IP may have changed) |
| Deployment stuck in Queued | `docker compose logs worker`; `docker compose ps` shows redis healthy? |
| GitHub login goes to the wrong host | OAuth app callback must be `https://app.shipnest.dpdns.org/api/github/callback` |
| Everything is slow | `docker system df`; free disk space, close other heavy apps |
