
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";

const execFileAsync = promisify(execFile);

const BUILD_IMAGE = "node:22-alpine";

const BUILD_TIMEOUT = 10 * 60 * 1000;
const MAX_LOG_BUFFER = 20 * 1024 * 1024;

export interface DockerBuildOptions {
  deploymentId: string;
  sourceDir: string;
  rootDir: string;
  installCommand: string;
  buildCommand: string;
}

export interface DockerBuildResult {
  output: string;
  durationMs: number;
}

function resolveProjectDirectory(
  sourceDir: string,
  rootDir: string,
): string {
  const source = path.resolve(sourceDir);
  const projectRoot = path.resolve(source, rootDir);

  const relative = path.relative(source, projectRoot);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Project root directory is outside the repository.");
  }

  return projectRoot;
}

export async function runDockerBuild(
  options: DockerBuildOptions,
): Promise<DockerBuildResult> {
  const {
    deploymentId,
    sourceDir,
    rootDir,
    installCommand,
    buildCommand,
  } = options;

  if (!/^[a-zA-Z0-9_-]+$/.test(deploymentId)) {
    throw new Error("Invalid deployment ID for Docker container.");
  }

  if (!installCommand.trim() || !buildCommand.trim()) {
    throw new Error("Install and build commands are required.");
  }

  const projectRoot = resolveProjectDirectory(sourceDir, rootDir);

  const containerName = `forgedeploy-build-${deploymentId}-${randomUUID()}`;

  const startedAt = Date.now();

  const command = [
    "set -e",
    installCommand,
    buildCommand,
  ].join(" && ");

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [
        "run",
        "--name",
        containerName,
        "--network",
        "bridge",
        "--memory",
        "2g",
        "--memory-swap",
        "2g",
        "--cpus",
        "2",
        "--pids-limit",
        "256",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=512m",
        "--volume",
        `${projectRoot}:/workspace`,
        "--workdir",
        "/workspace",
        "--env",
        "HOME=/tmp",
        BUILD_IMAGE,
        "sh",
        "-lc",
        command,
      ],
      {
        timeout: BUILD_TIMEOUT,
        maxBuffer: MAX_LOG_BUFFER,
        windowsHide: true,
      },
    );

    return {
      output: [stdout, stderr].filter(Boolean).join("\n"),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const buildError = error as Error & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };

    const logs = [
      buildError.stdout,
      buildError.stderr,
    ].filter(Boolean).join("\n");

    if (buildError.killed) {
      throw new Error(
        `Docker build timed out after ${BUILD_TIMEOUT / 60000} minutes.\n${logs}`,
      );
    }

    throw new Error(
      `Docker build failed: ${buildError.message}\n${logs}`,
    );
  } finally {
    try {
      await execFileAsync(
        "docker",
        ["rm", "-f", containerName],
        {
          timeout: 15_000,
          windowsHide: true,
        },
      );
    } catch {
      // Container may already have been removed.
    }
  }
}
