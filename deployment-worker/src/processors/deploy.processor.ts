
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";

import {
  getDeploymentContext,
  updateDeploymentStatus,
  publishDeploymentRecord,
  supersedeOtherDeployments,
} from "../services/deployment.service.js";

import { generateDeploymentUrl } from "../services/domain.service.js";
import { checkDeploymentHealth } from "../services/health.service.js";
import { NonRetryableError } from "../utils/errors.js";
import { writeDeploymentLog } from "../services/deployment-log.service.js";
import {
  completeDeploymentMetadata,
  saveBuildFailure,
} from "../services/deployment-metadata.service.js";

import type { ProcessBuildResult } from "./build.processor.js";

const STATIC_FRAMEWORKS = new Set([
  "vite",
  "create react app",
  "vue",
  "angular",
]);

async function logSafely(
  deploymentId: string,
  message: string,
  level: "INFO" | "WARN" | "ERROR" = "INFO",
): Promise<void> {
  try {
    await writeDeploymentLog({
      deploymentId,
      stage: "DEPLOY",
      message,
      level,
    });
  } catch (error) {
    console.error("Could not persist deployment log:", error);
  }
}

async function rejectSymlinks(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, {
    withFileTypes: true,
  });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isSymbolicLink()) {
      throw new NonRetryableError(
        `Build output contains an unsupported symbolic link: ${entry.name}`,
      );
    }

    if (entry.isDirectory()) {
      await rejectSymlinks(fullPath);
    }
  }
}

export async function deployStaticBuild(
  build: ProcessBuildResult,
  workerId: string,
  assertLease: () => Promise<void>,
): Promise<string | null> {
  const context = await getDeploymentContext(build.deploymentId);

  if (!context) {
    throw new Error("Deployment or project not found.");
  }

  if (
    context.deployment.status !== "BUILDING" &&
    context.deployment.status !== "DEPLOYING"
  ) {
    console.log(
      `Skipping deployment ${build.deploymentId}: status is ${context.deployment.status}`,
    );

    return null;
  }

if (!STATIC_FRAMEWORKS.has(build.framework.trim().toLowerCase())) {
    throw new NonRetryableError(
      `${build.framework} is not configured for static publishing. Runtime deployment support will be added separately.`,
    );
  }

  const source = path.resolve(build.outputPath);
  const destination = path.resolve(
    env.DEPLOYMENTS_DIR,
    build.deploymentId,
  );

  await fs.access(source);
  await rejectSymlinks(source);

 await assertLease();

const claimed = await updateDeploymentStatus(
  build.deploymentId,
  "DEPLOYING",
  workerId,
);

  if (!claimed) {
    throw new Error("Could not start deployment publishing.");
  }

  await logSafely(
    build.deploymentId,
    "Static deployment publishing started.",
  );

  let published = false;

  try {
    await assertLease();
    await fs.mkdir(path.dirname(destination), {
      recursive: true,
    });

    await fs.rm(destination, {
      recursive: true,
      force: true,
    });

    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });

    await logSafely(
      build.deploymentId,
      "Static build files copied successfully.",
    );

    const deploymentUrl = generateDeploymentUrl(
      build.deploymentId,
    );

    if (env.HEALTH_CHECK_ENABLED) {
      await assertLease();

      const checking = await updateDeploymentStatus(
        build.deploymentId,
        "HEALTH_CHECK",
        workerId,
      );

      if (!checking) {
        throw new Error("Could not start deployment health check.");
      }

      await logSafely(build.deploymentId, `Health check started: ${deploymentUrl}`);
      await checkDeploymentHealth(build.deploymentId);
      await logSafely(build.deploymentId, "Health check passed.");
    } else {
      await logSafely(
        build.deploymentId,
        "Health check skipped (HEALTH_CHECK_ENABLED=false).",
        "WARN",
      );
    }

    await assertLease();
    const recordUpdated = await publishDeploymentRecord(
  build.deploymentId,
  deploymentUrl,
  workerId,
);

    if (!recordUpdated) {
      throw new Error(
        "Build files were copied, but the deployment record could not be marked READY.",
      );
    }

    published = true;

    try {
      const { supersededOlder, selfSuperseded } =
        await supersedeOtherDeployments(build.deploymentId);

      if (supersededOlder > 0) {
        await logSafely(
          build.deploymentId,
          `Marked ${supersededOlder} older deployment(s) as SUPERSEDED.`,
        );
      }

      if (selfSuperseded) {
        await logSafely(
          build.deploymentId,
          "A newer deployment was already READY; this deployment is SUPERSEDED.",
          "WARN",
        );
      }
    } catch (error) {
      console.error(
        `Could not supersede other deployments for ${build.deploymentId}:`,
        error,
      );
    }

    try {
      await completeDeploymentMetadata(build.deploymentId);
    } catch (error) {
      console.error(
        `Could not save completion metadata for ${build.deploymentId}:`,
        error,
      );

      await logSafely(
        build.deploymentId,
        "Deployment is READY, but completion metadata could not be saved.",
        "WARN",
      );
    }

    await logSafely(
      build.deploymentId,
      `Deployment published successfully: ${deploymentUrl}`,
    );

    console.log(
      `Deployment ${build.deploymentId} published: ${deploymentUrl}`,
    );

    return deploymentUrl;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown deployment error";

    if (!published) {
      await fs.rm(destination, {
        recursive: true,
        force: true,
      }).catch(() => undefined);

     try {
  await assertLease();
  await saveBuildFailure(build.deploymentId, message);
} catch (metadataError) {
  console.error("Could not persist deployment failure:", metadataError);
}

      await logSafely(
        build.deploymentId,
        `Deployment publishing failed: ${message}`,
        "ERROR",
      );
    }

    throw error;
  }
}
