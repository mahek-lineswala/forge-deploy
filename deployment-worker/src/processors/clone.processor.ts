/**
 * Pipeline stage 1: shallow-clone the project's branch into this attempt's temp folder.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

import { env } from "../config/env.js";

import {
  getDeploymentContext,
  claimDeploymentForCloning,
} from "../services/deployment/deployment.service.js";

import { getGitHubRepositoryAccess } from "../services/github.service.js";
import { writeDeploymentLog } from "../services/deployment/deployment-log.service.js";
import { NonRetryableError, isNonRetryableError } from "../utils/errors.js";

const execFileAsync = promisify(execFile);

// git stderr patterns that will fail identically on every retry.
const PERMANENT_GIT_FAILURES = [
  /Authentication failed/i,
  /Invalid username or token/i,
  /could not read Username/i,
  /Repository not found/i,
  /Remote branch .* not found/i,
  /not found in upstream/i,
];

function isPermanentGitFailure(error: unknown): boolean {
  const stderr = (error as { stderr?: string })?.stderr ?? "";
  const message = error instanceof Error ? error.message : "";

  return PERMANENT_GIT_FAILURES.some(
    (pattern) => pattern.test(stderr) || pattern.test(message),
  );
}

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
  signal?: AbortSignal,
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
      throw new NonRetryableError("Repository branch is missing.");
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
        windowsHide: true,
        signal,
        env: {
          ...process.env,
          // Never fall back to an interactive prompt or the OS credential store.
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "never",
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraheader",
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authHeader}`,
        },
      },
    );

    await assertLease();

    if (!(await isValidRepository(destination))) {
      throw new NonRetryableError(
        "Repository cloned, but no package.json was found at the repository root.",
      );
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

    const wrapped = `GitHub repository cloning failed: ${message}`;

    if (isNonRetryableError(error) || isPermanentGitFailure(error)) {
      throw new NonRetryableError(wrapped);
    }

    throw new Error(wrapped);
  }
}
