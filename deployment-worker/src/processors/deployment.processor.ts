
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";

import {
  getDeploymentContext,
  ownsDeploymentLease,
  restartDeploymentForAttempt,
} from "../services/deployment.service.js";

import { cloneDeploymentRepository } from "./clone.processor.js";
import { processDeploymentBuild } from "./build.processor.js";
import { deployStaticBuild } from "./deploy.processor.js";

async function cleanupWorkspace(
  deploymentId: string,
  workerId: string,
): Promise<void> {
  const deploymentDirectory = path.resolve(
    env.TEMP_DIR,
    deploymentId,
  );

  const workspaceDirectory = path.resolve(
    deploymentDirectory,
    workerId,
  );

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

    const terminalStatuses = [
      "READY",
      "FAILED",
      "CANCELLED",
      "SUPERSEDED",
    ];

    if (terminalStatuses.includes(context.deployment.status)) {
      console.log(`Deployment ${deploymentId} is already terminal.`);
      return;
    }

    const restarted = await restartDeploymentForAttempt(
      deploymentId,
      workerId,
    );

    if (!restarted) {
      throw new Error("Could not restart deployment attempt.");
    }

    await assertLease();

    const clonedPath = await cloneDeploymentRepository(
      deploymentId,
      workerId,
      assertLease,
    );

    if (!clonedPath) {
      throw new Error("Repository cloning did not complete.");
    }

    await assertLease();

    const buildResult = await processDeploymentBuild(
      deploymentId,
      clonedPath,
      workerId,
      assertLease,
    );

    if (!buildResult) {
      throw new Error("Deployment build did not complete.");
    }

    await assertLease();

    const deploymentUrl = await deployStaticBuild(
      buildResult,
      workerId,
      assertLease,
    );

    if (!deploymentUrl) {
      throw new Error("Deployment publishing did not complete.");
    }

    console.log(`Deployment successful: ${deploymentUrl}`);
  } finally {
    await cleanupWorkspace(deploymentId, workerId);
  }
}
