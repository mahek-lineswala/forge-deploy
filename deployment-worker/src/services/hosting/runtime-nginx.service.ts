import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { env } from "../../config/env.js";
import { docker } from "../../lib/docker.js";
import { assertDeploymentId } from "../../utils/deployment-id.js";

/**
 * Runtime routes are entries of the Nginx map `$deployment_id -> $runtime_upstream`
 * (infra/nginx/nginx.conf). Each runtime deployment gets one file
 * <RUNTIME_NGINX_DIR>/<deploymentId>.map containing a single line:
 *
 *   <deploymentId> <containerName>:<port>;
 *
 * The shared deployment server block proxies to that upstream when it is set and
 * serves static files otherwise, so routes work with any domain and on every
 * listener (HTTPS, internal health-check port). Container names are resolved per
 * request through Docker's DNS, so a removed container only returns 502 for its
 * own site and never breaks `nginx -t` or reloads.
 */

const ROUTE_EXTENSION = ".map";

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
  return path.join(routeDirectory(), `${deploymentId}${ROUTE_EXTENSION}`);
}

function createRouteConfig(deploymentId: string, containerName: string, port: number): string {
  return `# Managed by ForgeDeploy. Do not edit.\n${deploymentId} ${containerName}:${port};\n`;
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

/**
 * Converts route files from the previous format (one `<id>.conf` server block per
 * deployment) into `<id>.map` entries. Safe to run on every start.
 */
export function migrateLegacyRuntimeRoutes(): Promise<number> {
  return serialize(async () => {
    const entries = await fs.readdir(routeDirectory()).catch(() => [] as string[]);
    let migrated = 0;

    for (const entry of entries) {
      const match = entry.match(/^([a-f0-9]{24})\.conf$/);

      if (!match) continue;

      const deploymentId = match[1]!;
      const legacyPath = path.join(routeDirectory(), entry);
      const legacy = await fs.readFile(legacyPath, "utf8");
      const upstream = legacy.match(/http:\/\/([a-zA-Z0-9][a-zA-Z0-9_.-]*):(\d+)/);

      if (upstream) {
        await writeAtomically(
          routePath(deploymentId),
          createRouteConfig(deploymentId, upstream[1]!, Number(upstream[2])),
        );
      }

      await fs.rm(legacyPath, { force: true });
      migrated += 1;
    }

    if (migrated > 0) {
      await testAndReload();
    }

    return migrated;
  });
}

export function removeRuntimeRoute(deploymentId: string): Promise<void> {
  assertDeploymentId(deploymentId);

  return serialize(() => applyRoute(deploymentId, null));
}
