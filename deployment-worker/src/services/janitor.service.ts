import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { ObjectId } from "mongodb";

import { env } from "../config/env.js";
import { getDatabase } from "../lib/mongodb.js";
import { BUILD_CONTAINER_PREFIX, BUILD_TIMEOUT } from "./docker.service.js";
import type { DeploymentDocument } from "../types/deployment.types.js";

const execFileAsync = promisify(execFile);

// Longer than clone (2 min) + build (10 min) + publish, so a live attempt is never touched.
const STALE_AFTER_MS = 60 * 60 * 1000;
const CONTAINER_STALE_AFTER_MS = BUILD_TIMEOUT + 5 * 60 * 1000;

async function ageMs(target: string): Promise<number | null> {
  const stats = await fs.stat(target).catch(() => null);

  return stats ? Date.now() - stats.mtimeMs : null;
}

async function removeDirectory(target: string): Promise<boolean> {
  try {
    await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    return true;
  } catch (error) {
    console.error(`[Janitor] Could not remove ${target}:`, (error as Error).message);
    return false;
  }
}

async function attemptIsLive(deploymentId: string, attemptId: string): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const live = await getDatabase()
    .collection<DeploymentDocument>("Deployment")
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
  const deployments = await fs.readdir(tempRoot, { withFileTypes: true }).catch(() => []);
  let removed = 0;

  for (const deployment of deployments) {
    if (!deployment.isDirectory()) continue;

    const deploymentDir = path.join(tempRoot, deployment.name);
    const attempts = await fs.readdir(deploymentDir, { withFileTypes: true }).catch(() => []);

    for (const attempt of attempts) {
      if (!attempt.isDirectory()) continue;

      const attemptDir = path.join(deploymentDir, attempt.name);
      const age = await ageMs(attemptDir);

      if (age === null || age < STALE_AFTER_MS) continue;
      if (await attemptIsLive(deployment.name, attempt.name)) continue;

      if (await removeDirectory(attemptDir)) removed += 1;
    }

    await fs.rmdir(deploymentDir).catch(() => undefined); // only if now empty
  }

  return removed;
}

/** deployments/.staging and deployments/.trash leftovers from interrupted publishes. */
async function cleanPublishLeftovers(): Promise<number> {
  const root = path.resolve(env.DEPLOYMENTS_DIR);
  let removed = 0;

  for (const folder of [".staging", ".trash"]) {
    const dir = path.join(root, folder);
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      const age = await ageMs(target);

      if (age !== null && age >= STALE_AFTER_MS && (await removeDirectory(target))) {
        removed += 1;
      }
    }
  }

  return removed;
}

/** Build containers that outlived the build timeout (worker crashed or was killed). */
async function cleanOrphanContainers(): Promise<number> {
  const { stdout: ids } = await execFileAsync(
    "docker",
    ["ps", "-aq", "--filter", `name=${BUILD_CONTAINER_PREFIX}`],
    { timeout: 15_000, windowsHide: true },
  );

  const containerIds = ids.split(/\s+/).filter(Boolean);

  if (containerIds.length === 0) return 0;

  const { stdout } = await execFileAsync(
    "docker",
    ["inspect", "--format", "{{.Id}} {{.Created}}", ...containerIds],
    { timeout: 15_000, windowsHide: true },
  );

  const stale = stdout
    .split("\n")
    .map((line) => line.trim().split(" "))
    .filter(([id, created]) => id && created)
    .filter(([, created]) => Date.now() - new Date(created!).getTime() > CONTAINER_STALE_AFTER_MS)
    .map(([id]) => id!);

  if (stale.length === 0) return 0;

  await execFileAsync("docker", ["rm", "-f", ...stale], { timeout: 30_000, windowsHide: true });

  return stale.length;
}

async function safely(label: string, task: () => Promise<number>): Promise<number> {
  try {
    return await task();
  } catch (error) {
    console.error(`[Janitor] ${label} failed:`, (error as Error).message);
    return 0;
  }
}

let running = false;

export async function runJanitor(): Promise<void> {
  if (running) return;
  running = true;

  try {
    const workspaces = await safely("Workspace cleanup", cleanTempWorkspaces);
    const leftovers = await safely("Publish leftover cleanup", cleanPublishLeftovers);
    const containers = await safely("Container cleanup", cleanOrphanContainers);

    if (workspaces + leftovers + containers > 0) {
      console.log(
        `[Janitor] Removed ${workspaces} stale workspace(s), ${leftovers} publish leftover(s), ${containers} orphan container(s).`,
      );
    }
  } finally {
    running = false;
  }
}
