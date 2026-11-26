/**
 * Pipeline stage 2: detect build settings, run the sandboxed install/build and record
 * build metadata and logs. Static output is exported back to the host.
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  getDeploymentContext,
  claimDeploymentForBuilding,
} from "../services/deployment/deployment.service.js";

import { detectBuildConfiguration } from "../services/build/build-config.service.js";
import { exportBuildOutput, runDockerBuild } from "../services/build/build-sandbox.service.js";
import { loadBuildEnvironment } from "../services/environment.service.js";

import { writeDeploymentLog } from "../services/deployment/deployment-log.service.js";

import {
  saveBuildMetadata,
  saveBuildFailure,
} from "../services/deployment/deployment-metadata.service.js";

import type { ProcessBuildResult } from "../types/build.types.js";
import { NonRetryableError } from "../utils/errors.js";

/** Folders that speed up rebuilds when kept between deployments of a project. */
function buildCachePaths(framework: string): string[] {
  return /next/i.test(framework) ? [".next/cache"] : [];
}

async function persistBuildOutput(
  deploymentId: string,
  output: string,
  stage: "INSTALL" | "BUILD" = "BUILD",
): Promise<void> {
  const maxOutputLength = 50_000;
  const truncatedOutput = output.slice(-maxOutputLength);
  const chunkSize = 8_000;

  if (output.length > maxOutputLength) {
    await writeDeploymentLog({
      deploymentId,
      stage,
      level: "WARN",
      message: "Output was truncated to the latest 50,000 characters.",
    });
  }

  for (
    let index = 0;
    index < truncatedOutput.length;
    index += chunkSize
  ) {
    const chunk = truncatedOutput.slice(index, index + chunkSize);

    await writeDeploymentLog({
      deploymentId,
      stage,
      message: chunk,
    });
  }
}

export async function processDeploymentBuild(
  deploymentId: string,
  sourceDir: string,
  workerId: string,
  assertLease: () => Promise<void>,
  signal?: AbortSignal,
): Promise<ProcessBuildResult | null> {
  const context = await getDeploymentContext(deploymentId);

  if (!context) {
    throw new Error("Deployment or project not found.");
  }

  if (
    context.deployment.status !== "CLONING" &&
    context.deployment.status !== "BUILDING"
  ) {
    console.log(
      `Skipping build ${deploymentId}: status is ${context.deployment.status}`,
    );

    return null;
  }

  await assertLease();

  const claimed = await claimDeploymentForBuilding(
    deploymentId,
    workerId,
  );

  if (!claimed) {
    console.log(
      `Could not claim build ${deploymentId}. It may have been cancelled.`,
    );

    return null;
  }

  await writeDeploymentLog({
    deploymentId,
    stage: "BUILD",
    message: "Build process started.",
  });

  try {
    const configuration = await detectBuildConfiguration(
      sourceDir,
      context.project,
    );

    await assertLease();

    await saveBuildMetadata(deploymentId, {
      framework: configuration.framework,
      buildCommand: configuration.buildCommand,
      packageManager: configuration.packageManager,
      outputDir: configuration.outputDir,
      deploymentType: configuration.deploymentType,
      startCommand: configuration.startCommand,
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      message:
        `Detected framework: ${configuration.framework}. ` +
        `Deployment type: ${configuration.deploymentType}. ` +
        `Package manager: ${configuration.packageManager}.`,
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "INSTALL",
      message:
        `Dependency installation started using ${configuration.packageManager}.`,
    });

    console.log(
      `Building ${configuration.framework} project using ${configuration.packageManager}`,
    );

    const { variables: environment, skipped } =
      await loadBuildEnvironment(context.project);

    if (environment.length > 0) {
      await writeDeploymentLog({
        deploymentId,
        stage: "BUILD",
        message:
          `Loaded ${environment.length} environment variable(s) ` +
          `for the build step: ${environment.map((v) => v.key).join(", ")}`,
      });
    }

    if (skipped.length > 0) {
      await writeDeploymentLog({
        deploymentId,
        stage: "BUILD",
        level: "WARN",
        message:
          `Ignored reserved or invalid environment variable name(s): ${skipped.join(", ")}`,
      });
    }

    await assertLease();

    const buildResult = await runDockerBuild({
      deploymentId,
      workerId,
      projectId: context.project._id.toHexString(),
      sourceDir,
      cachePaths: buildCachePaths(configuration.framework),
      rootDir: configuration.rootDir,
      installCommand: configuration.installCommand,
      buildCommand: configuration.buildCommand,
      environment,
      signal,
    });

    await assertLease();

    for (const phase of buildResult.phases) {
      await persistBuildOutput(
        deploymentId,
        phase.output,
        phase.stage,
      );
    }

    const projectRoot = path.resolve(
      sourceDir,
      configuration.rootDir,
    );

    if (configuration.deploymentType === "RUNTIME") {
      if (!configuration.startCommand) {
        throw new NonRetryableError(
          "Runtime application is missing a start command.",
        );
      }

      await saveBuildMetadata(deploymentId, {
        framework: configuration.framework,
        buildCommand: configuration.buildCommand,
        packageManager: configuration.packageManager,
        outputDir: configuration.outputDir,
        deploymentType: configuration.deploymentType,
        startCommand: configuration.startCommand,
        buildDurationMs: buildResult.durationMs,
      });

      await writeDeploymentLog({
        deploymentId,
        stage: "BUILD",
        message:
          `Runtime build completed successfully in ${buildResult.durationMs} ms. ` +
          `Start command: ${configuration.startCommand}.`,
      });

      console.log(
        `Runtime build completed for deployment ${deploymentId}`,
      );

      return {
        deploymentId,
        framework: configuration.framework,
        deploymentType: "RUNTIME",
        sourcePath: projectRoot,
        rootDir: configuration.rootDir,
        projectPath: buildResult.projectPath,
        startCommand: configuration.startCommand,
        buildLogs: buildResult.output,
        durationMs: buildResult.durationMs,
      };
    }

    const outputPath = path.resolve(
      projectRoot,
      configuration.outputDir,
    );

    const relativeOutput = path.relative(
      projectRoot,
      outputPath,
    );

    if (
      relativeOutput === ".." ||
      relativeOutput.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeOutput)
    ) {
      throw new NonRetryableError(
        "Build output directory is outside the project root.",
      );
    }

    // The build ran inside a Docker volume; copy only the output back to the host.
    await exportBuildOutput({
      deploymentId,
      workerId,
      projectPath: buildResult.projectPath,
      outputDir: configuration.outputDir,
      hostDestination: outputPath,
      signal,
    });

    const outputStats = await fs.stat(outputPath).catch(() => null);

    if (!outputStats?.isDirectory()) {
      throw new NonRetryableError(
        `Build completed but output directory was not found: ${configuration.outputDir}`,
      );
    }

    await assertLease();

    await saveBuildMetadata(deploymentId, {
      framework: configuration.framework,
      buildCommand: configuration.buildCommand,
      packageManager: configuration.packageManager,
      outputDir: configuration.outputDir,
      deploymentType: configuration.deploymentType,
      startCommand: configuration.startCommand,
      buildDurationMs: buildResult.durationMs,
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      message:
        `Build completed successfully in ${buildResult.durationMs} ms. ` +
        `Output directory: ${configuration.outputDir}.`,
    });

    console.log(`Build completed for deployment ${deploymentId}`);

    return {
      deploymentId,
      framework: configuration.framework,
      deploymentType: "STATIC",
      outputPath,
      buildLogs: buildResult.output,
      durationMs: buildResult.durationMs,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown build error";

    try {
      await assertLease();

      await saveBuildFailure(deploymentId, message);

      await writeDeploymentLog({
        deploymentId,
        stage: "BUILD",
        level: "ERROR",
        message: `Build failed: ${message}`,
      });
    } catch (loggingError) {
      console.error(
        `Could not persist build failure for ${deploymentId}:`,
        loggingError,
      );
    }

    throw error;
  }
}
