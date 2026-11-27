/**
 * Periodic cleanup of resources left by crashed or finished attempts: temp folders,
 * publish leftovers, build containers/volumes and unused runtime containers/images/routes.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ObjectId } from "mongodb";

import { env } from "../config/env.js";
import { COLLECTIONS } from "../constants/collections.js";
import { RETIRED_DEPLOYMENT_STATUSES } from "../constants/deployment-status.js";
import { isDeploymentId } from "../utils/deployment-id.js";
import { getDatabase } from "../lib/mongodb.js";
import {
  BUILD_CONTAINER_PREFIX,
  BUILD_TIMEOUT,
} from "./build/build-sandbox.service.js";
import {
  removeRuntimeContainer,
  removeRuntimeImage,
} from "./hosting/runtime-container.service.js";
import { reconcileSubdomainAliases } from "./hosting/alias.service.js";
import { removeRuntimeRoute } from "./hosting/runtime-nginx.service.js";

import type { DeploymentDocument } from "../types/deployment.types.js";

const execFileAsync = promisify(execFile);

const STALE_AFTER_MS = 60 * 60 * 1000;
const CONTAINER_STALE_AFTER_MS = BUILD_TIMEOUT + 5 * 60 * 1000;

const RUNTIME_CONTAINER_PREFIX = "forgedeploy-runtime-";
const RUNTIME_IMAGE_PREFIX = "forgedeploy-runtime:";


async function ageMs(target: string): Promise<number | null> {
  const stats = await fs.stat(target).catch(() => null);

  return stats ? Date.now() - stats.mtimeMs : null;
}

async function removeDirectory(target: string): Promise<boolean> {
  try {
    await fs.rm(target, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 500,
    });

    return true;
  } catch (error) {
    console.error(
      `[Janitor] Could not remove ${target}:`,
      (error as Error).message,
    );

    return false;
  }
}

async function attemptIsLive(
  deploymentId: string,
  attemptId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const live = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .findOne(
      {
        _id: new ObjectId(deploymentId),
        workerId: attemptId,
        leaseExpiresAt: { $gt: new Date() },
      },
      { projection: { _id: 1 } },
    );

  return live !== null;
}

/** temp/<deploymentId>/<attemptId> left behind by crashed or killed attempts. */
async function cleanTempWorkspaces(): Promise<number> {
  const tempRoot = path.resolve(env.TEMP_DIR);

  const deployments = await fs
    .readdir(tempRoot, { withFileTypes: true })
    .catch(() => []);

  let removed = 0;

  for (const deployment of deployments) {
    if (!deployment.isDirectory()) continue;

    const deploymentDir = path.join(tempRoot, deployment.name);

    const attempts = await fs
      .readdir(deploymentDir, { withFileTypes: true })
      .catch(() => []);

    for (const attempt of attempts) {
      if (!attempt.isDirectory()) continue;

      const attemptDir = path.join(deploymentDir, attempt.name);
      const age = await ageMs(attemptDir);

      if (age === null || age < STALE_AFTER_MS) continue;

      if (await attemptIsLive(deployment.name, attempt.name)) continue;

      if (await removeDirectory(attemptDir)) {
        removed += 1;
      }
    }

    await fs.rmdir(deploymentDir).catch(() => undefined);
  }

  return removed;
}

/** deployments/.staging and deployments/.trash leftovers from interrupted publishes. */
async function cleanPublishLeftovers(): Promise<number> {
  const root = path.resolve(env.DEPLOYMENTS_DIR);

  let removed = 0;

  for (const folder of [".staging", ".trash"]) {
    const dir = path.join(root, folder);

    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      const age = await ageMs(target);

      if (
        age !== null &&
        age >= STALE_AFTER_MS &&
        (await removeDirectory(target))
      ) {
        removed += 1;
      }
    }
  }

  return removed;
}

/** Build containers that outlived the build timeout. */
async function cleanOrphanContainers(): Promise<number> {
  const { stdout: ids } = await execFileAsync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `name=${BUILD_CONTAINER_PREFIX}`,
    ],
    {
      timeout: 15_000,
      windowsHide: true,
    },
  );

  const containerIds = ids.split(/\s+/).filter(Boolean);

  if (containerIds.length === 0) return 0;

  const { stdout } = await execFileAsync(
    "docker",
    [
      "inspect",
      "--format",
      "{{.Id}} {{.Created}}",
      ...containerIds,
    ],
    {
      timeout: 15_000,
      windowsHide: true,
    },
  );

  const stale = stdout
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter(([id, created]) => id && created)
    .filter(
      ([, created]) =>
        Date.now() - new Date(created!).getTime() >
        CONTAINER_STALE_AFTER_MS,
    )
    .map(([id]) => id!);

  if (stale.length === 0) return 0;

  await execFileAsync(
    "docker",
    ["rm", "-f", ...stale],
    {
      timeout: 30_000,
      windowsHide: true,
    },
  );

  return stale.length;
}

interface RuntimeContainerInfo {
  name: string;
  createdAt: Date;
}

async function listRuntimeContainers(): Promise<RuntimeContainerInfo[]> {
  const { stdout: ids } = await execFileAsync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `name=${RUNTIME_CONTAINER_PREFIX}`,
    ],
    {
      timeout: 15_000,
      windowsHide: true,
    },
  );

  const containerIds = ids.split(/\s+/).filter(Boolean);

  if (containerIds.length === 0) return [];

  const { stdout } = await execFileAsync(
    "docker",
    [
      "inspect",
      "--format",
      "{{.Name}} {{.Created}}",
      ...containerIds,
    ],
    {
      timeout: 15_000,
      windowsHide: true,
    },
  );

  return stdout
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter(([name, created]) => name && created)
    .map(([name, created]) => ({
      name: name!.replace(/^\//, ""),
      createdAt: new Date(created!),
    }))
    .filter(
      (container) =>
        new RegExp(
          `^${RUNTIME_CONTAINER_PREFIX}[a-f0-9]{24}-[a-f0-9-]+$`,
          "i",
        ).test(container.name) &&
        !Number.isNaN(container.createdAt.getTime()),
    );
}

async function listRuntimeImages(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "images",
      "--format",
      "{{.Repository}}:{{.Tag}}",
      "--filter",
      `reference=${RUNTIME_IMAGE_PREFIX}*`,
    ],
    {
      timeout: 15_000,
      windowsHide: true,
    },
  );

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((imageName) =>
      /^forgedeploy-runtime:[a-f0-9]{24}-[a-f0-9-]+$/i.test(
        imageName,
      ),
    );
}

function getDeploymentIdFromContainer(name: string): string | null {
  const match = name.match(
    /^forgedeploy-runtime-([a-f0-9]{24})-/i,
  );

  return match?.[1] ?? null;
}

function getDeploymentIdFromImage(imageName: string): string | null {
  const match = imageName.match(
    /^forgedeploy-runtime:([a-f0-9]{24})-/i,
  );

  return match?.[1] ?? null;
}

/**
 * A runtime container/image may be removed when its deployment no longer exists
 * or is FAILED, CANCELLED or SUPERSEDED. READY and in-progress deployments are
 * always kept.
 */
async function shouldRemoveRuntimeResources(
  deploymentId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) return true;

  const deployment = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .findOne(
      { _id: new ObjectId(deploymentId) },
      { projection: { status: 1 } },
    );

  if (!deployment) return true;

  return RETIRED_DEPLOYMENT_STATUSES.has(deployment.status);
}

/** Reconcile persistent runtime containers and their images against MongoDB. */
async function cleanOrphanRuntimeResources(): Promise<number> {
  const [containers, images] = await Promise.all([
    listRuntimeContainers(),
    listRuntimeImages(),
  ]);

  let removed = 0;
  const routesToRemove = new Set<string>();

  for (const container of containers) {
    const deploymentId = getDeploymentIdFromContainer(
      container.name,
    );

    if (!deploymentId) continue;

    const stale = await shouldRemoveRuntimeResources(deploymentId);

    if (!stale) continue;

    try {
      await removeRuntimeContainer(container.name);
      routesToRemove.add(deploymentId);
      removed += 1;

      console.log(
        `[Janitor] Removed orphan runtime container ${container.name}.`,
      );
    } catch (error) {
      console.error(
        `[Janitor] Could not remove runtime container ${container.name}:`,
        (error as Error).message,
      );
    }
  }

  for (const imageName of images) {
    const deploymentId = getDeploymentIdFromImage(imageName);

    if (!deploymentId) continue;

    const stale = await shouldRemoveRuntimeResources(deploymentId);

    if (!stale) continue;

    try {
      await removeRuntimeImage(imageName);
      removed += 1;

      console.log(
        `[Janitor] Removed orphan runtime image ${imageName}.`,
      );
    } catch (error) {
      console.error(
        `[Janitor] Could not remove runtime image ${imageName}:`,
        (error as Error).message,
      );
    }
  }

  for (const deploymentId of routesToRemove) {
    try {
      await removeRuntimeRoute(deploymentId);
    } catch (error) {
      console.error(
        `[Janitor] Could not remove runtime route for ${deploymentId}:`,
        (error as Error).message,
      );
    }
  }

  return removed;
}

async function safely(
  label: string,
  task: () => Promise<number>,
): Promise<number> {
  try {
    return await task();
  } catch (error) {
    console.error(
      `[Janitor] ${label} failed:`,
      (error as Error).message,
    );

    return 0;
  }
}

/** Build workspace volumes left by crashed attempts (normally removed right after each deployment). */
async function cleanWorkspaceVolumes(): Promise<number> {
  const { stdout: names } = await execFileAsync(
    "docker",
    ["volume", "ls", "-q", "--filter", "label=forgedeploy.workspace=1"],
    { timeout: 15_000, windowsHide: true },
  );

  const volumeNames = names.split(/\s+/).filter(Boolean);

  if (volumeNames.length === 0) return 0;

  const { stdout } = await execFileAsync(
    "docker",
    [
      "volume",
      "inspect",
      "--format",
      '{{.Name}} {{.CreatedAt}} {{index .Labels "forgedeploy.deployment"}} {{index .Labels "forgedeploy.attempt"}}',
      ...volumeNames,
    ],
    { timeout: 15_000, windowsHide: true },
  );

  let removed = 0;

  for (const line of stdout.split("\n")) {
    const [name, createdAt, deploymentId, attemptId] = line.trim().split(" ");

    if (!name || !createdAt || !deploymentId || !attemptId) continue;

    const age = Date.now() - new Date(createdAt).getTime();

    if (Number.isNaN(age) || age < STALE_AFTER_MS) continue;
    if (await attemptIsLive(deploymentId, attemptId)) continue;

    try {
      await execFileAsync("docker", ["volume", "rm", "-f", name], {
        timeout: 30_000,
        windowsHide: true,
      });
      removed += 1;
    } catch (error) {
      console.error(`[Janitor] Could not remove volume ${name}:`, (error as Error).message);
    }
  }

  return removed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Published static files of retired deployments (FAILED, CANCELLED, SUPERSEDED),
 * kept for DEPLOYMENT_RETENTION_DAYS so recent deployments can still be inspected.
 * READY and in-progress deployments are never touched.
 */
async function cleanRetiredStaticDeployments(): Promise<number> {
  const root = path.resolve(env.DEPLOYMENTS_DIR);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const retentionMs = env.DEPLOYMENT_RETENTION_DAYS * DAY_MS;
  let removed = 0;

  for (const entry of entries) {
    // Skips .staging/.trash and anything that is not a deployment folder.
    if (!entry.isDirectory() || !isDeploymentId(entry.name)) continue;

    const directory = path.join(root, entry.name);
    const deployment = await getDatabase()
      .collection<DeploymentDocument>(COLLECTIONS.deployments)
      .findOne({ _id: new ObjectId(entry.name) }, { projection: { status: 1, updatedAt: 1 } });

    if (deployment) {
      if (!RETIRED_DEPLOYMENT_STATUSES.has(deployment.status)) continue;
      if (Date.now() - new Date(deployment.updatedAt).getTime() < retentionMs) continue;
    } else {
      // No record (e.g. deleted): remove once the folder is clearly not being published.
      const age = await ageMs(directory);
      if (age === null || age < STALE_AFTER_MS) continue;
    }

    if (await removeDirectory(directory)) removed += 1;
  }

  return removed;
}

let running = false;

export async function runJanitor(): Promise<void> {
  if (running) return;

  running = true;

  try {
    const workspaces = await safely(
      "Workspace cleanup",
      cleanTempWorkspaces,
    );

    const leftovers = await safely(
      "Publish leftover cleanup",
      cleanPublishLeftovers,
    );

    const buildContainers = await safely(
      "Build container cleanup",
      cleanOrphanContainers,
    );

    const retiredStatic = await safely(
      "Retired static deployment cleanup",
      cleanRetiredStaticDeployments,
    );

    const runtimeResources = await safely(
      "Runtime resource cleanup",
      cleanOrphanRuntimeResources,
    );

    const volumes = await safely(
      "Workspace volume cleanup",
      cleanWorkspaceVolumes,
    );

    // Keeps custom subdomains pointing at the latest live deployment, even after missed jobs.
    await safely("Subdomain reconciliation", reconcileSubdomainAliases);

    if (
      workspaces +
        leftovers +
        buildContainers +
        runtimeResources +
        retiredStatic +
        volumes >
      0
    ) {
      console.log(
        `[Janitor] Removed ${workspaces} stale workspace(s), ${leftovers} publish leftover(s), ${retiredStatic} retired static deployment(s), ${buildContainers} build container(s), ${runtimeResources} runtime resource(s), and ${volumes} workspace volume(s).`,
      );
    }
  } finally {
    running = false;
  }
}
