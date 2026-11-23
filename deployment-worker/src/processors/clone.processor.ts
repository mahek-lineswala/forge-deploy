
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

import { env } from "../config/env.js";

import {
  getDeploymentContext,
  claimDeploymentForCloning,
} from "../services/deployment.service.js";

import { getGitHubRepositoryAccess } from "../services/github.service.js";
import { writeDeploymentLog } from "../services/deployment-log.service.js";

const execFileAsync = promisify(execFile);

async function isValidRepository(directory: string): Promise<boolean> {
  try {
    const gitDirectory = path.join(directory, ".git");
    const packageFile = path.join(directory, "package.json");

    const [gitStats, packageStats] = await Promise.all([
      fs.stat(gitDirectory),
      fs.stat(packageFile),
    ]);

    return gitStats.isDirectory() && packageStats.isFile();
  } catch {
    return false;
  }
}

export async function cloneDeploymentRepository(
  deploymentId: string,
  workerId: string,
  assertLease: () => Promise<void>,
): Promise<string | null> {
  await assertLease();

  const context = await getDeploymentContext(deploymentId);

  if (!context) {
    throw new Error(`Deployment not found: ${deploymentId}`);
  }

  if (
    context.deployment.status !== "QUEUED" &&
    context.deployment.status !== "CLONING"
  ) {
    console.log(
      `Skipping clone stage. Current status: ${context.deployment.status}`,
    );
    return null;
  }

  const claimed = await claimDeploymentForCloning(
    deploymentId,
    workerId,
  );

  if (!claimed) {
    throw new Error("Could not claim deployment for cloning.");
  }

  const destination = path.resolve(
  env.TEMP_DIR,
  deploymentId,
  workerId,
);

  try {
    await assertLease();

    if (await isValidRepository(destination)) {
      await writeDeploymentLog({
        deploymentId,
        stage: "CLONE",
        message: "Existing cloned repository found. Reusing workspace.",
      });

      return destination;
    }

    const github = await getGitHubRepositoryAccess(context.project);

    if (!github.branch.trim()) {
      throw new Error("Repository branch is missing.");
    }

    await assertLease();

    await fs.mkdir(path.dirname(destination), {
      recursive: true,
    });

    await fs.rm(destination, {
      recursive: true,
      force: true,
    });

    await assertLease();

    const authHeader = Buffer.from(
      `x-access-token:${github.accessToken}`,
    ).toString("base64");

    await writeDeploymentLog({
      deploymentId,
      stage: "CLONE",
      message: "Repository cloning started.",
    });

    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        `--branch=${github.branch}`,
        github.repositoryUrl,
        destination,
      ],
      {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authHeader}`,
        },
      },
    );

    await assertLease();

    if (!(await isValidRepository(destination))) {
      throw new Error("Repository clone completed but workspace is invalid.");
    }

    await writeDeploymentLog({
      deploymentId,
      stage: "CLONE",
      message: "Repository cloned successfully.",
    });

    console.log(`Repository cloned: ${destination}`);

    return destination;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown cloning error";

    try {
      await assertLease();

      await fs.rm(destination, {
        recursive: true,
        force: true,
      });

      await writeDeploymentLog({
        deploymentId,
        stage: "CLONE",
        level: "ERROR",
        message: `Repository cloning failed: ${message}`,
      });
    } catch {
      console.error(
        `Skipped clone cleanup because the deployment lease was lost: ${deploymentId}`,
      );
    }

    throw new Error(`GitHub repository cloning failed: ${message}`);
  }
}
