import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../config/env.js";
import {
  redactSecrets,
  toShellExports,
  type BuildEnvironmentVariable,
} from "./environment.service.js";

const SECRETS_MOUNT = "/run/forgedeploy";

const execFileAsync = promisify(execFile);

const BUILD_IMAGE = "node:22-alpine";

export const BUILD_TIMEOUT = 10 * 60 * 1000;
export const BUILD_CONTAINER_PREFIX = "forgedeploy-build-";

const MAX_LOG_BUFFER = 20 * 1024 * 1024;

export interface DockerBuildOptions {
  deploymentId: string;
  sourceDir: string;
  rootDir: string;
  installCommand: string;
  buildCommand: string;
  environment?: BuildEnvironmentVariable[];
  signal?: AbortSignal;
}

export interface DockerBuildResult {
  output: string;
  durationMs: number;
}

type ExecError = Error & {
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  code?: string | number;
};

function resolveProjectDirectory(sourceDir: string, rootDir: string): string {
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

async function removeContainer(name: string): Promise<void> {
  try {
    // rm -f also kills the container if it is still running.
    await execFileAsync("docker", ["rm", "-f", name], {
      timeout: 15_000,
      windowsHide: true,
    });
  } catch {
    // Container may never have been created.
  }
}

interface ContainerRun {
  name: string;
  network: "bridge" | "none";
  command: string;
  timeoutMs: number;
  projectRoot: string;
  secretsDir?: string;
  signal?: AbortSignal;
}

async function runContainer(run: ContainerRun): Promise<string> {
  const args = [
    "run",
    "--name", run.name,
    "--init",
    "--network", run.network,
    "--user", env.BUILD_USER,
    "--read-only",
    "--memory", "2g",
    "--memory-swap", "2g",
    "--cpus", "2",
    "--pids-limit", "256",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
    "--volume", `${run.projectRoot}:/workspace`,
    ...(run.secretsDir ? ["--volume", `${run.secretsDir}:${SECRETS_MOUNT}:ro`] : []),
    "--workdir", "/workspace",
    "--env", "HOME=/tmp",
    // Caches live in the workspace (not tmpfs) so the offline build step can reuse them.
    "--env", "npm_config_cache=/workspace/.forgedeploy/npm-cache",
    "--env", "npm_config_update_notifier=false",
    "--env", "COREPACK_HOME=/workspace/.forgedeploy/corepack",
    "--env", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    BUILD_IMAGE,
    "sh", "-c", `set -e; ${run.command}`,
  ];

  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: run.timeoutMs,
      maxBuffer: MAX_LOG_BUFFER,
      windowsHide: true,
      signal: run.signal,
    });

    return [stdout, stderr].filter(Boolean).join("\n");
  } catch (error) {
    const execError = error as ExecError;
    const logs = [execError.stdout, execError.stderr].filter(Boolean).join("\n");

    if (run.signal?.aborted) {
      throw new Error(`Build cancelled.\n${logs}`);
    }

    if (execError.killed) {
      throw new Error(
        `Docker build timed out after ${BUILD_TIMEOUT / 60000} minutes.\n${logs}`,
      );
    }

    throw new Error(`Docker build failed: ${execError.message}\n${logs}`);
  } finally {
    await removeContainer(run.name);
  }
}

export async function runDockerBuild(
  options: DockerBuildOptions,
): Promise<DockerBuildResult> {
  const { deploymentId, sourceDir, rootDir, installCommand, buildCommand, signal } =
    options;
  const environment = options.environment ?? [];

  if (!/^[a-zA-Z0-9_-]+$/.test(deploymentId)) {
    throw new Error("Invalid deployment ID for Docker container.");
  }

  if (!installCommand.trim() || !buildCommand.trim()) {
    throw new Error("Install and build commands are required.");
  }

  const projectRoot = resolveProjectDirectory(sourceDir, rootDir);
  const attempt = randomUUID();
  const startedAt = Date.now();
  const remaining = () => Math.max(1_000, BUILD_TIMEOUT - (Date.now() - startedAt));

  const outputs: string[] = [];

  // Project env vars go in a read-only mount OUTSIDE the workspace, so they
  // never end up in the build output, and only the build step loads them.
  let secretsDir: string | undefined;
  let buildStep = buildCommand;

  if (environment.length > 0) {
    secretsDir = `${path.resolve(sourceDir)}.secrets`;
    await fs.mkdir(secretsDir, { recursive: true });
    await fs.writeFile(path.join(secretsDir, "env.sh"), toShellExports(environment), {
      mode: 0o600,
    });
    buildStep = `. ${SECRETS_MOUNT}/env.sh; ${buildCommand}`;
  }

  try {
    if (env.BUILD_NETWORK_ISOLATION) {
      // Phase 1: install with network access.
      outputs.push(
        await runContainer({
          name: `${BUILD_CONTAINER_PREFIX}${deploymentId}-${attempt}-install`,
          network: "bridge",
          command: installCommand,
          timeoutMs: remaining(),
          projectRoot,
          signal,
        }),
      );

      // Phase 2: run project build scripts with no network at all.
      outputs.push(
        await runContainer({
          name: `${BUILD_CONTAINER_PREFIX}${deploymentId}-${attempt}-build`,
          network: "none",
          command: buildStep,
          timeoutMs: remaining(),
          projectRoot,
          secretsDir,
          signal,
        }),
      );
    } else {
      outputs.push(
        await runContainer({
          name: `${BUILD_CONTAINER_PREFIX}${deploymentId}-${attempt}`,
          network: "bridge",
          command: `${installCommand} && ${buildStep}`,
          timeoutMs: remaining(),
          projectRoot,
          secretsDir,
          signal,
        }),
      );
    }
  } catch (error) {
    // Build tools sometimes echo env values in errors; never persist them.
    throw new Error(
      redactSecrets(error instanceof Error ? error.message : String(error), environment),
    );
  } finally {
    if (secretsDir) {
      await fs.rm(secretsDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    output: redactSecrets(outputs.filter(Boolean).join("\n"), environment),
    durationMs: Date.now() - startedAt,
  };
}
