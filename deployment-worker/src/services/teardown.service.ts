/**
 * Releases everything a deployment occupies on this machine: the Nginx route, the
 * published files, the runtime container and image, and leftover build resources.
 * Every step is safe to repeat and runs even if an earlier one fails.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { docker } from "../lib/docker.js";
import { assertDeploymentId } from "../utils/deployment-id.js";
import { removeRuntimeContainer, removeRuntimeImage } from "./hosting/runtime-container.service.js";
import { removeRuntimeRoute } from "./hosting/runtime-nginx.service.js";

async function removeDirectory(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
}

async function dockerLines(args: string[]): Promise<string[]> {
  const output = await docker(args, { timeoutMs: 15_000, output: "stdout" });

  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function removeDeploymentResources(deploymentId: string): Promise<void> {
  assertDeploymentId(deploymentId);

  const failures: string[] = [];

  async function step(label: string, action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // 1. Stop serving first, so the URL goes offline immediately.
  await step("Nginx route", () => removeRuntimeRoute(deploymentId));
  await step("Published files", () => removeDirectory(path.join(path.resolve(env.DEPLOYMENTS_DIR), deploymentId)));

  // 2. Runtime container(s) and image(s).
  await step("Runtime containers", async () => {
    const names = await dockerLines([
      "ps", "-a",
      "--filter", `name=^forgedeploy-runtime-${deploymentId}-`,
      "--format", "{{.Names}}",
    ]);

    for (const name of names) await removeRuntimeContainer(name);
  });

  await step("Runtime images", async () => {
    const images = await dockerLines([
      "images",
      "--format", "{{.Repository}}:{{.Tag}}",
      "--filter", `reference=forgedeploy-runtime:${deploymentId}-*`,
    ]);

    for (const image of images) await removeRuntimeImage(image);
  });

  // 3. Build leftovers of this deployment (aborted attempts).
  await step("Build workspace", () => removeDirectory(path.join(path.resolve(env.TEMP_DIR), deploymentId)));

  await step("Build volumes", async () => {
    const volumes = await dockerLines([
      "volume", "ls", "-q",
      "--filter", "label=forgedeploy.workspace=1",
      "--filter", `label=forgedeploy.deployment=${deploymentId}`,
    ]);

    for (const volume of volumes) {
      await docker(["volume", "rm", "-f", volume], { timeoutMs: 30_000 });
    }
  });

  if (failures.length > 0) {
    // BullMQ retries the job; the janitor also removes orphans of deleted deployments.
    throw new Error(`Could not fully remove deployment ${deploymentId}: ${failures.join("; ")}`);
  }
}
