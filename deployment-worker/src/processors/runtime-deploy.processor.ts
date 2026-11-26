/**
 * Pipeline stage 3 (server apps): create the runtime image, start its container,
 * register the Nginx route, health-check it and mark the deployment READY.
 */
import { env } from "../config/env.js";
import { loadBuildEnvironment } from "../services/environment.service.js";
import { writeDeploymentLogSafely } from "../services/deployment/deployment-log.service.js";
import {
  completeDeploymentMetadata,
  saveBuildFailure,
} from "../services/deployment/deployment-metadata.service.js";
import {
  getDeploymentContext,
  publishDeploymentRecord,
  saveRuntimeContainerMetadata,
  supersedeOtherDeployments,
  updateDeploymentStatus,
} from "../services/deployment/deployment.service.js";
import { generateDeploymentUrl } from "../services/hosting/domain.service.js";
import { checkRuntimeDeploymentHealth } from "../services/hosting/health.service.js";
import {
  buildRuntimeImage,
  removeRuntimeContainer,
  removeRuntimeImage,
  runtimeAppDirectory,
  startRuntimeContainer,
} from "../services/hosting/runtime-container.service.js";
import {
  addRuntimeRoute,
  removeRuntimeRoute,
} from "../services/hosting/runtime-nginx.service.js";
import type { RuntimeBuildResult } from "../types/build.types.js";

async function cleanupSafely(
  operation: () => Promise<unknown>,
  description: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    console.error(`Runtime cleanup failed (${description}):`, error);
  }
}

export async function deployRuntimeBuild(
  build: RuntimeBuildResult,
  workerId: string,
  assertLease: () => Promise<void>,
  signal?: AbortSignal,
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
      `Skipping runtime deployment ${build.deploymentId}: status is ${context.deployment.status}`,
    );

    return null;
  }

  await assertLease();

  const claimed = await updateDeploymentStatus(
    build.deploymentId,
    "DEPLOYING",
    workerId,
  );

  if (!claimed) {
    throw new Error("Could not start runtime deployment.");
  }

  let imageName: string | null = null;
  let runtimeContainer: Awaited<
    ReturnType<typeof startRuntimeContainer>
  > | null = null;
  let routeRegistered = false;
  let published = false;

  try {
    await writeDeploymentLogSafely(
      build.deploymentId,
      "Runtime deployment started.",
    );

    await assertLease();

    const { variables, skipped } = await loadBuildEnvironment(
      context.project,
    );

    if (skipped.length > 0) {
      await writeDeploymentLogSafely(
        build.deploymentId,
        `Skipped invalid or reserved environment variable keys: ${skipped.join(", ")}`,
        "WARN",
      );
    }

    await writeDeploymentLogSafely(
      build.deploymentId,
      "Creating runtime image from the build workspace.",
    );

    imageName = await buildRuntimeImage({
      deploymentId: build.deploymentId,
      workerId,
      projectPath: build.projectPath,
      startCommand: build.startCommand,
      signal,
    });

    await assertLease();

    await writeDeploymentLogSafely(
      build.deploymentId,
      `Runtime image created: ${imageName}.`,
    );

    runtimeContainer = await startRuntimeContainer({
      deploymentId: build.deploymentId,
      imageName,
      environment: variables,
      // Next.js writes its image/ISR cache at runtime; the rest of the filesystem stays read-only.
      writablePaths: /next/i.test(build.framework)
        ? [`${runtimeAppDirectory(build.projectPath)}/.next/cache`]
        : [],
      signal,
    });

    await assertLease();

    const metadataSaved = await saveRuntimeContainerMetadata(
      build.deploymentId,
      runtimeContainer.containerId,
      runtimeContainer.port,
      workerId,
    );

    if (!metadataSaved) {
      throw new Error(
        "Runtime container started, but its metadata could not be saved.",
      );
    }

    await writeDeploymentLogSafely(
      build.deploymentId,
      `Runtime container started on internal port ${runtimeContainer.port}.`,
    );

    await assertLease();

    await addRuntimeRoute(
      build.deploymentId,
      runtimeContainer.containerName,
      runtimeContainer.port,
    );

    routeRegistered = true;

    const deploymentUrl = generateDeploymentUrl(
      build.deploymentId,
    );

    await writeDeploymentLogSafely(
      build.deploymentId,
      `Runtime route registered: ${deploymentUrl}`,
    );

    if (env.HEALTH_CHECK_ENABLED) {
      await assertLease();

      const checking = await updateDeploymentStatus(
        build.deploymentId,
        "HEALTH_CHECK",
        workerId,
      );

      if (!checking) {
        throw new Error("Could not start runtime health check.");
      }

      await writeDeploymentLogSafely(
        build.deploymentId,
        `Runtime health check started: ${deploymentUrl}`,
        "INFO",
        "HEALTH_CHECK",
      );

      await checkRuntimeDeploymentHealth(build.deploymentId);

      await writeDeploymentLogSafely(
        build.deploymentId,
        "Runtime health check passed.",
        "INFO",
        "HEALTH_CHECK",
      );
    } else {
      await writeDeploymentLogSafely(
        build.deploymentId,
        "Health check skipped.",
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
        "Runtime started, but the deployment could not be marked READY.",
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
          "A newer deployment was already READY; cleaning up this superseded runtime.",
          "WARN",
        );

        await cleanupSafely(
          () => removeRuntimeRoute(build.deploymentId),
          "superseded runtime Nginx route",
        );

        await cleanupSafely(
          () => removeRuntimeContainer(runtimeContainer!.containerName),
          "superseded runtime container",
        );

        await cleanupSafely(
          () => removeRuntimeImage(imageName!),
          "superseded runtime image",
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

      await writeDeploymentLogSafely(
        build.deploymentId,
        "Deployment is READY, but completion metadata could not be saved.",
        "WARN",
      );
    }

    await writeDeploymentLogSafely(
      build.deploymentId,
      `Runtime deployment published successfully: ${deploymentUrl}`,
    );

    console.log(
      `Runtime deployment ${build.deploymentId} published: ${deploymentUrl}`,
    );

    return deploymentUrl;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown runtime deployment error";

    const stillOwner = await assertLease().then(
      () => true,
      () => false,
    );

    if (!published && stillOwner) {
      if (routeRegistered) {
        await cleanupSafely(
          () => removeRuntimeRoute(build.deploymentId),
          "Nginx route",
        );
      }

      if (runtimeContainer) {
        await cleanupSafely(
          () => removeRuntimeContainer(runtimeContainer!.containerName),
          "runtime container",
        );
      }

      if (imageName) {
        await cleanupSafely(
          () => removeRuntimeImage(imageName!),
          "runtime image",
        );
      }

      try {
        await assertLease();
        await saveBuildFailure(build.deploymentId, message);
      } catch (metadataError) {
        console.error(
          "Could not persist runtime deployment failure:",
          metadataError,
        );
      }

      await writeDeploymentLogSafely(
        build.deploymentId,
        `Runtime deployment failed: ${message}`,
        "ERROR",
      );
    }

    throw error;
  }
}
