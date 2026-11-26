import { randomUUID } from "node:crypto";
import path from "node:path";

import { env } from "../../config/env.js";
import { docker } from "../../lib/docker.js";
import { assertDeploymentId } from "../../utils/deployment-id.js";
import {
  BUILD_CONTAINER_PREFIX,
  BUILD_IMAGE,
  workspaceVolumeName,
} from "../build/build-sandbox.service.js";
import type { BuildEnvironmentVariable } from "../environment.service.js";

/**
 * Runtime images are created with `docker run` + `docker commit` straight from
 * the build's workspace volume. There is no `docker build` and no build context,
 * so nothing (node_modules, symlinks) is read back from the host filesystem.
 */

const APP_DIR = "/app";
const DEFAULT_PORT = 3000;

export interface RuntimeImageOptions {
  deploymentId: string;
  workerId: string;
  /** Project root inside the workspace, POSIX relative ("." or "apps/web"). */
  projectPath: string;
  startCommand: string;
  signal?: AbortSignal;
}

export interface RuntimeContainerOptions {
  deploymentId: string;
  imageName: string;
  environment: BuildEnvironmentVariable[];
  /** Absolute in-container paths that must stay writable (tmpfs), e.g. Next.js cache. */
  writablePaths?: string[];
  signal?: AbortSignal;
}

export interface RuntimeContainerResult {
  imageName: string;
  containerId: string;
  containerName: string;
  port: number;
}

function validateProjectPath(projectPath: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(projectPath) || projectPath.split("/").includes("..")) {
    throw new Error("Invalid runtime project path.");
  }
}

/** Working directory of the app inside the runtime image. */
export function runtimeAppDirectory(projectPath: string): string {
  validateProjectPath(projectPath);
  return path.posix.join(APP_DIR, projectPath);
}

function resolveRuntimePort(environment: BuildEnvironmentVariable[]): number {
  const portVariable = environment.find((variable) => variable.key === "PORT");

  if (!portVariable) {
    return DEFAULT_PORT;
  }

  const port = Number(portVariable.value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The PORT environment variable must be a valid port between 1 and 65535.");
  }

  return port;
}

/** `exec` the start command when it is a single command, so it receives SIGTERM directly. */
function containerCommand(startCommand: string): string[] {
  const command = startCommand.trim();
  const isSingleCommand = !/[;&|<>`$()\n]/.test(command.replace(/\$\{?PORT\}?/g, ""));

  return ["sh", "-c", isSingleCommand ? `exec ${command}` : command];
}

export async function buildRuntimeImage(options: RuntimeImageOptions): Promise<string> {
  assertDeploymentId(options.deploymentId);

  const appDirectory = runtimeAppDirectory(options.projectPath);
  const suffix = randomUUID().slice(0, 8);
  const imageName = `forgedeploy-runtime:${options.deploymentId}-${suffix}`;
  const packager = `${BUILD_CONTAINER_PREFIX}${options.deploymentId}-${options.workerId}-package`;
  const volume = workspaceVolumeName(options.deploymentId, options.workerId);

  // Copy the whole workspace (keeps hoisted monorepo node_modules), minus caches and .env files.
  // Ownership (the build user) is preserved, so the app can run as "node" without a chown pass.
  const packageScript = [
    "set -e",
    `mkdir -p ${APP_DIR}`,
    `cp -a /workspace/. ${APP_DIR}/`,
    `rm -rf ${APP_DIR}/.forgedeploy ${APP_DIR}/.git`,
    `find ${APP_DIR} -name node_modules -prune -o \\( -name '.env' -o -name '.env.*' \\) -type f -exec rm -f {} +`,
  ].join("; ");

  try {
    await docker(
      [
        "run",
        "--name", packager,
        "--network", "none",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        // root + these capabilities: needed only to preserve file ownership while copying.
        "--cap-add", "CHOWN",
        "--cap-add", "FOWNER",
        "--cap-add", "DAC_OVERRIDE",
        "--volume", `${volume}:/workspace:ro`,
        BUILD_IMAGE,
        "sh", "-c", packageScript,
      ],
      { timeoutMs: 10 * 60 * 1000, signal: options.signal, label: "Runtime image packaging" },
    );

    const binPath = [
      path.posix.join(appDirectory, "node_modules/.bin"),
      path.posix.join(APP_DIR, "node_modules/.bin"),
      "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    ].join(":");

    await docker(
      [
        "commit",
        "--change", "ENV NODE_ENV=production",
        "--change", `ENV PORT=${DEFAULT_PORT}`,
        "--change", "ENV HOME=/tmp",
        "--change", "ENV NEXT_TELEMETRY_DISABLED=1",
        "--change", `ENV PATH=${binPath}`,
        "--change", `WORKDIR ${appDirectory}`,
        "--change", "USER node",
        "--change", `LABEL forgedeploy.deployment=${options.deploymentId}`,
        "--change", `CMD ${JSON.stringify(containerCommand(options.startCommand))}`,
        packager,
        imageName,
      ],
      { timeoutMs: 5 * 60 * 1000, signal: options.signal, label: "Runtime image commit" },
    );

    return imageName;
  } catch (error) {
    throw new Error(
      `Runtime image creation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await docker(["rm", "-f", packager], { timeoutMs: 15_000 }).catch(() => undefined);
  }
}

export async function startRuntimeContainer(
  options: RuntimeContainerOptions,
): Promise<RuntimeContainerResult> {
  assertDeploymentId(options.deploymentId);

  const port = resolveRuntimePort(options.environment);
  const suffix = randomUUID().slice(0, 8);
  const containerName = `forgedeploy-runtime-${options.deploymentId}-${suffix}`;

  const environment = [...options.environment];

  if (!environment.some((variable) => variable.key === "PORT")) {
    environment.push({ key: "PORT", value: String(port) });
  }

  for (const variable of environment) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key) || variable.value.includes("\0")) {
      throw new Error(`Invalid runtime environment variable: ${variable.key}`);
    }
  }

  for (const writablePath of options.writablePaths ?? []) {
    if (!/^\/[A-Za-z0-9._/-]+$/.test(writablePath) || writablePath.split("/").includes("..")) {
      throw new Error(`Invalid writable runtime path: ${writablePath}`);
    }
  }

  const args = [
    "run",
    "--detach",
    "--name", containerName,
    "--init",
    "--restart", "unless-stopped",
    "--network", env.RUNTIME_DOCKER_NETWORK,
    "--memory", env.RUNTIME_CONTAINER_MEMORY,
    "--cpus", env.RUNTIME_CONTAINER_CPUS,
    "--pids-limit", "256",
    "--read-only",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
    "--tmpfs", "/run:rw,noexec,nosuid,size=16m",
    ...(options.writablePaths ?? []).flatMap((writablePath) => [
      "--tmpfs",
      `${writablePath}:rw,noexec,nosuid,size=256m,mode=1777`,
    ]),
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--label", `forgedeploy.deployment=${options.deploymentId}`,
    ...environment.flatMap((variable) => ["--env", `${variable.key}=${variable.value}`]),
    options.imageName,
  ];

  if (options.signal?.aborted) {
    throw new Error("Runtime container startup was cancelled.");
  }

  try {
    const containerId = (
      await docker(args, { timeoutMs: 30_000, signal: options.signal, label: "Runtime container start" })
    ).trim();

    if (!/^[a-f0-9]{12,64}$/i.test(containerId)) {
      throw new Error("Docker returned an invalid container ID.");
    }

    return { imageName: options.imageName, containerId, containerName, port };
  } catch (error) {
    // Never echo env values (they are in the docker arguments) into logs.
    const message = error instanceof Error ? error.message : String(error);
    const redacted = environment.reduce(
      (text, variable) => (variable.value.length >= 6 ? text.split(variable.value).join(`[${variable.key}]`) : text),
      message,
    );

    throw new Error(`Could not start runtime container: ${redacted}`);
  }
}

export async function removeRuntimeContainer(containerName: string): Promise<void> {
  if (!/^forgedeploy-runtime-[a-f0-9-]+$/i.test(containerName)) {
    throw new Error("Invalid ForgeDeploy runtime container name.");
  }

  await docker(["rm", "--force", containerName], { timeoutMs: 30_000 });
}

export async function removeRuntimeImage(imageName: string): Promise<void> {
  if (!/^forgedeploy-runtime:[a-f0-9-]+$/i.test(imageName)) {
    throw new Error("Invalid ForgeDeploy runtime image name.");
  }

  await docker(["image", "rm", "--force", imageName], { timeoutMs: 30_000 });
}
