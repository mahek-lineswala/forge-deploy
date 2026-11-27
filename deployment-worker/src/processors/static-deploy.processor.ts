/**
 * Pipeline stage 3 (static sites): atomically publish build output, health-check it
 * through Nginx and mark the deployment READY.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";

import {
  getDeploymentContext,
  updateDeploymentStatus,
  publishDeploymentRecord,
  supersedeOtherDeployments,
} from "../services/deployment/deployment.service.js";

import { syncAliasForDeployment } from "../services/hosting/alias.service.js";
import { generateDeploymentUrl } from "../services/hosting/domain.service.js";
import { checkDeploymentHealth } from "../services/hosting/health.service.js";
import { NonRetryableError } from "../utils/errors.js";
import { publishDirectoryAtomically } from "../services/hosting/static-publish.service.js";
import { writeDeploymentLogSafely } from "../services/deployment/deployment-log.service.js";
import {
  completeDeploymentMetadata,
  saveBuildFailure,
} from "../services/deployment/deployment-metadata.service.js";

import type { StaticBuildResult } from "../types/build.types.js";

const STATIC_FRAMEWORKS = new Set([
  "vite",
  "create react app",
  "vue",
  "angular",
]);

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
  build: StaticBuildResult,
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

  await writeDeploymentLogSafely(
    build.deploymentId,
    "Static deployment publishing started.",
  );

  let published = false;

  try {
    await assertLease();

    await publishDirectoryAtomically(
      source,
      destination,
      workerId,
      assertLease,
    );

    await writeDeploymentLogSafely(
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

      await writeDeploymentLogSafely(
        build.deploymentId,
        `Health check started: ${deploymentUrl}`,
        "INFO",
        "HEALTH_CHECK",
      );

      await checkDeploymentHealth(build.deploymentId);

      await writeDeploymentLogSafely(
        build.deploymentId,
        "Health check passed.",
        "INFO",
        "HEALTH_CHECK",
      );
    } else {
      await writeDeploymentLogSafely(
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
        await writeDeploymentLogSafely(
          build.deploymentId,
          `Marked ${supersededOlder} older deployment(s) as SUPERSEDED.`,
        );
      }

      if (selfSuperseded) {
        await writeDeploymentLogSafely(
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
      await syncAliasForDeployment(build.deploymentId);
    } catch (error) {
      console.error(
        `Could not update the custom subdomain for ${build.deploymentId}:`,
        error,
      );

      await writeDeploymentLogSafely(
        build.deploymentId,
        "Deployment is live, but its custom subdomain could not be updated yet. It is retried automatically.",
        "WARN",
      );
    }

    try {
      await completeDeploymentMetadata(build.deploymentId);
    } catch (error) {
      console.error(
        `Could not save completion metadata for ${build.deploymentId}:`,
        error,
      );

      await writeDeploymentLogSafely(
        build.deploymentId,
        "Deployment is READY, but completion metadata could not be saved.",
        "WARN",
      );
    }

    await writeDeploymentLogSafely(
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
      // Only the current lease owner may remove the published files;
      // a stale attempt must not delete a newer attempt's output.
      const stillOwner = await assertLease().then(
        () => true,
        () => false,
      );

      if (stillOwner) {
        await fs.rm(destination, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }

      try {
        await assertLease();
        await saveBuildFailure(build.deploymentId, message);
      } catch (metadataError) {
        console.error("Could not persist deployment failure:", metadataError);
      }

      await writeDeploymentLogSafely(
        build.deploymentId,
        `Deployment publishing failed: ${message}`,
        "ERROR",
      );
    }

    throw error;
  }
}
