
import fs from "node:fs/promises";
import path from "node:path";

import {
  getDeploymentContext,
  claimDeploymentForBuilding,
} from "../services/deployment.service.js";

import { detectBuildConfiguration } from "../services/build.service.js";
import { runDockerBuild } from "../services/docker.service.js";

import { writeDeploymentLog } from "../services/deployment-log.service.js";

import {
  saveBuildMetadata,
  saveBuildFailure,
} from "../services/deployment-metadata.service.js";
import { NonRetryableError } from "../utils/errors.js";

export interface ProcessBuildResult {
  deploymentId: string;
  framework: string;
  outputPath: string;
  buildLogs: string;
  durationMs: number;
}

async function persistBuildOutput(
  deploymentId: string,
  output: string,
): Promise<void> {
  const maxOutputLength = 50_000;
  const truncatedOutput = output.slice(-maxOutputLength);
  const chunkSize = 8_000;

  if (output.length > maxOutputLength) {
    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      level: "WARN",
      message: "Build output was truncated to the latest 50,000 characters.",
    });
  }

  for (let index = 0; index < truncatedOutput.length; index += chunkSize) {
    const chunk = truncatedOutput.slice(index, index + chunkSize);

    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      message: chunk,
    });
  }
}

export async function processDeploymentBuild(
  deploymentId: string,
  sourceDir: string,
  workerId: string,
  assertLease: () => Promise<void>,
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
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      message: `Detected framework: ${configuration.framework}. Package manager: ${configuration.packageManager}.`,
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "INSTALL",
      message: `Dependency installation started using ${configuration.packageManager}.`,
    });

    console.log(
      `Building ${configuration.framework} project using ${configuration.packageManager}`,
    );

    await assertLease();
    const buildResult = await runDockerBuild({
      deploymentId,
      sourceDir,
      rootDir: configuration.rootDir,
      installCommand: configuration.installCommand,
      buildCommand: configuration.buildCommand,
    });
    await assertLease();

    await persistBuildOutput(deploymentId, buildResult.output);

    await writeDeploymentLog({
      deploymentId,
      stage: "INSTALL",
      message: "Build container completed its dependency installation and build commands.",
    });

    const projectRoot = path.resolve(sourceDir, configuration.rootDir);
    const outputPath = path.resolve(projectRoot, configuration.outputDir);

    const relativeOutput = path.relative(projectRoot, outputPath);

    if (
      relativeOutput === ".." ||
      relativeOutput.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeOutput)
    ) {
      throw new NonRetryableError("Build output directory is outside the project root.");
    }

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
      buildDurationMs: buildResult.durationMs,
    });

    await writeDeploymentLog({
      deploymentId,
      stage: "BUILD",
      message: `Build completed successfully in ${buildResult.durationMs} ms. Output directory: ${configuration.outputDir}.`,
    });

    console.log(`Build completed for deployment ${deploymentId}`);

    return {
      deploymentId,
      framework: configuration.framework,
      outputPath,
      buildLogs: buildResult.output,
      durationMs: buildResult.durationMs,
    };
    } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown build error";

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
