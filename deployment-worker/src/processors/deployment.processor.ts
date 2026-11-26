/**
 * Runs one deployment attempt end to end:
 *   clone → build (in a Docker volume) → publish (static files or runtime container)
 * and always cleans up this attempt's workspace afterwards.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import { TERMINAL_DEPLOYMENT_STATUSES } from "../constants/deployment-status.js";
import { removeWorkspaceVolume } from "../services/build/build-sandbox.service.js";
import {
  getDeploymentContext,
  ownsDeploymentLease,
  restartDeploymentForAttempt,
} from "../services/deployment/deployment.service.js";

import { processDeploymentBuild } from "./build.processor.js";
import { cloneDeploymentRepository } from "./clone.processor.js";
import { deployRuntimeBuild } from "./runtime-deploy.processor.js";
import { deployStaticBuild } from "./static-deploy.processor.js";

async function cleanupWorkspace(
  deploymentId: string,
  workerId: string,
): Promise<void> {
  const deploymentDirectory = path.resolve(env.TEMP_DIR, deploymentId);
  const workspaceDirectory = path.resolve(deploymentDirectory, workerId);

  try {
    // Delete only this worker attempt's workspace.
    await fs.rm(workspaceDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 1000,
    });

    console.log(
      `[Worker] Cleaned workspace for deployment ${deploymentId}, attempt ${workerId}`,
    );

    // The build ran in a Docker volume; the runtime image (if any) is already committed.
    await removeWorkspaceVolume(deploymentId, workerId);

    // Remove the deployment directory only if it is empty.
    // Other concurrent attempts are therefore protected.
    await fs.rmdir(deploymentDirectory).catch(() => undefined);
  } catch (error) {
    console.error(
      `[Worker] Workspace cleanup failed for ${deploymentId}:`,
      error,
    );
  }
}

export async function processDeployment(
  deploymentId: string,
  workerId: string,
  isLeaseLost: () => boolean,
  signal?: AbortSignal,
): Promise<void> {
  const assertLease = async (): Promise<void> => {
    if (isLeaseLost()) {
      throw new Error("Deployment lease was lost.");
    }

    if (!(await ownsDeploymentLease(deploymentId, workerId))) {
      throw new Error("Worker no longer owns this deployment lease.");
    }
  };

  console.log(`Processing deployment: ${deploymentId}`);

  try {
    await assertLease();

    const context = await getDeploymentContext(deploymentId);

    if (!context) {
      throw new Error("Deployment or project not found.");
    }

    if (TERMINAL_DEPLOYMENT_STATUSES.has(context.deployment.status)) {
      console.log(`Deployment ${deploymentId} is already terminal.`);
      return;
    }

    const restarted = await restartDeploymentForAttempt(deploymentId, workerId);

    if (!restarted) {
      throw new Error("Could not restart deployment attempt.");
    }

    // 1. Clone
    await assertLease();

    const clonedPath = await cloneDeploymentRepository(
      deploymentId,
      workerId,
      assertLease,
      signal,
    );

    if (!clonedPath) {
      throw new Error("Repository cloning did not complete.");
    }

    // 2. Build
    await assertLease();

    const buildResult = await processDeploymentBuild(
      deploymentId,
      clonedPath,
      workerId,
      assertLease,
      signal,
    );

    if (!buildResult) {
      throw new Error("Deployment build did not complete.");
    }

    // 3. Publish
    await assertLease();

    const deploymentUrl =
      buildResult.deploymentType === "STATIC"
        ? await deployStaticBuild(buildResult, workerId, assertLease)
        : await deployRuntimeBuild(buildResult, workerId, assertLease, signal);

    if (!deploymentUrl) {
      throw new Error("Deployment publishing did not complete.");
    }

    console.log(`Deployment successful: ${deploymentUrl}`);
  } finally {
    await cleanupWorkspace(deploymentId, workerId);
  }
}
