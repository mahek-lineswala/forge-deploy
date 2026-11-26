import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { docker } from "../../lib/docker.js";
import { assertDeploymentId } from "../../utils/deployment-id.js";

/**
 * One Nginx file per runtime deployment: <RUNTIME_NGINX_DIR>/<deploymentId>.conf,
 * included by infra/nginx/nginx.conf with `include /etc/nginx/runtime/*.conf`.
 *
 * The upstream is a variable, so Nginx resolves the container name per request
 * through Docker's DNS (resolver 127.0.0.11 in nginx.conf). A stopped or removed
 * container then returns 502 for that one site instead of making every later
 * `nginx -t` / reload fail with "host not found in upstream".
 */

function validateContainerName(containerName: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName)) {
    throw new Error("Invalid runtime container name.");
  }
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Invalid runtime container port.");
  }
}

function routeDirectory(): string {
  return path.resolve(env.RUNTIME_NGINX_DIR);
}

function routePath(deploymentId: string): string {
  return path.join(routeDirectory(), `${deploymentId}.conf`);
}

function createRouteConfig(deploymentId: string, containerName: string, port: number): string {
  return `# Managed by ForgeDeploy. Do not edit.
server {
    listen 80;
    server_name ${deploymentId}.localhost;

    client_max_body_size 10m;

    location / {
        set $forgedeploy_upstream http://${containerName}:${port};
        proxy_pass $forgedeploy_upstream;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $forgedeploy_connection_upgrade;

        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
`;
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomically(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Temp name does not end in .conf, so Nginx never includes a half-written file.
  const temporaryPath = path.join(path.dirname(filePath), `.${randomUUID()}.tmp`);

  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o644 });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function testAndReload(): Promise<void> {
  await docker(["exec", env.NGINX_CONTAINER_NAME, "nginx", "-t"], { timeoutMs: 15_000, label: "nginx -t" });
  await docker(["exec", env.NGINX_CONTAINER_NAME, "nginx", "-s", "reload"], {
    timeoutMs: 15_000,
    label: "nginx reload",
  });
}

/** Writes (or removes) one route file, validates, reloads; restores the previous file on failure. */
async function applyRoute(deploymentId: string, content: string | null): Promise<void> {
  const filePath = routePath(deploymentId);
  const previous = await readIfExists(filePath);

  if (previous === content) return;

  if (content === null) {
    await fs.rm(filePath, { force: true });
  } else {
    await writeAtomically(filePath, content);
  }

  try {
    await testAndReload();
  } catch (error) {
    if (previous === null) {
      await fs.rm(filePath, { force: true });
    } else {
      await writeAtomically(filePath, previous);
    }

    await testAndReload().catch(() => undefined);

    throw new Error(
      `Failed to apply runtime Nginx configuration: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Serialize reloads inside this worker process so concurrent deployments
// do not test/reload over each other's half-applied changes.
let queue: Promise<void> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function addRuntimeRoute(deploymentId: string, containerName: string, port: number): Promise<void> {
  assertDeploymentId(deploymentId);
  validateContainerName(containerName);
  validatePort(port);

  return serialize(() => applyRoute(deploymentId, createRouteConfig(deploymentId, containerName, port)));
}

export function removeRuntimeRoute(deploymentId: string): Promise<void> {
  assertDeploymentId(deploymentId);

  return serialize(() => applyRoute(deploymentId, null));
}
