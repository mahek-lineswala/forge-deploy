import fs from "node:fs/promises";
import path from "node:path";

import { env } from "../../config/env.js";
import { DockerCommandError, docker } from "../../lib/docker.js";
import { NonRetryableError } from "../../utils/errors.js";
import {
  redactSecrets,
  toShellExports,
  type BuildEnvironmentVariable,
} from "../environment.service.js";

/**
 * Builds run inside a Docker named volume, never on the host filesystem.
 *
 * Why: on Windows/macOS Docker Desktop, bind-mounted host folders are slow for
 * the tens of thousands of small files in node_modules (npm install + next build
 * took ~13 min), and Linux symlinks in node_modules/.bin cannot be read back by
 * the Docker CLI on Windows ("invalid file request"). Inside a volume both
 * problems disappear. Only static output is copied back to the host.
 *
 *   host clone ──seed──▶ volume forgedeploy-ws-<deployment>-<attempt>
 *                          ├─ install  (network, shared dependency cache rw)
 *                          ├─ build    (no network, cache ro, project build cache rw)
 *                          ├─ export   static output → host (static deployments)
 *                          └─ package  docker commit → runtime image (runtime deployments)
 */

export const BUILD_IMAGE = "node:22-alpine";
export const BUILD_TIMEOUT = 20 * 60 * 1000;
export const BUILD_CONTAINER_PREFIX = "forgedeploy-build-";
export const WORKSPACE_VOLUME_PREFIX = "forgedeploy-ws-";
const PROJECT_CACHE_VOLUME_PREFIX = "forgedeploy-cache-";

const SECRETS_MOUNT = "/run/forgedeploy";
const CACHE_MOUNT = "/cache";
const WORKSPACE_MOUNT = "/workspace";

export interface DockerBuildOptions {
  deploymentId: string;
  workerId: string;
  projectId: string;
  sourceDir: string;
  rootDir: string;
  installCommand: string;
  buildCommand: string;
  /** Project-relative folders kept between deployments of the same project, e.g. ".next/cache". */
  cachePaths?: string[];
  environment?: BuildEnvironmentVariable[];
  signal?: AbortSignal;
}

export interface DockerBuildPhaseOutput {
  stage: "INSTALL" | "BUILD";
  output: string;
}

export interface DockerBuildResult {
  output: string;
  phases: DockerBuildPhaseOutput[];
  durationMs: number;
  workspaceVolume: string;
  /** Project root inside the workspace volume, POSIX, relative ("." or "apps/web"). */
  projectPath: string;
}

// ============================================
// NAMES AND PATHS
// ============================================

function assertSafeId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9-]+$/.test(value)) {
    throw new Error(`Invalid ${label} for Docker resources.`);
  }
}

export function workspaceVolumeName(deploymentId: string, workerId: string): string {
  assertSafeId(deploymentId, "deployment ID");
  assertSafeId(workerId, "worker ID");
  return `${WORKSPACE_VOLUME_PREFIX}${deploymentId}-${workerId}`;
}

function projectCacheVolumeName(projectId: string, cachePath: string): string {
  assertSafeId(projectId, "project ID");
  const slug = cachePath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return `${PROJECT_CACHE_VOLUME_PREFIX}${projectId}-${slug || "root"}`;
}

/** Validates a repository-relative path and returns it in POSIX form. */
export function toProjectPath(sourceDir: string, rootDir: string): string {
  const source = path.resolve(sourceDir);
  const projectRoot = path.resolve(source, rootDir);
  const relative = path.relative(source, projectRoot);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new NonRetryableError("Project root directory is outside the repository.");
  }

  const posix = relative.split(path.sep).join("/") || ".";

  // Also embedded in shell commands and Docker --change values.
  if (!/^[A-Za-z0-9._/-]+$/.test(posix)) {
    throw new NonRetryableError(`Unsupported characters in project root directory: ${rootDir}`);
  }

  return posix;
}

function workspacePath(...segments: string[]): string {
  return path.posix.join(WORKSPACE_MOUNT, ...segments);
}

function buildOwner(): string {
  return env.BUILD_USER === "root" ? "0:0" : env.BUILD_USER;
}

// ============================================
// DOCKER HELPERS
// ============================================

async function removeContainer(name: string): Promise<void> {
  // rm -f also kills the container if it is still running.
  await docker(["rm", "-f", name], { timeoutMs: 15_000 }).catch(() => undefined);
}

/** Creates a volume (idempotent). Ownership is fixed by the prepare step in runDockerBuild. */
async function ensureVolume(name: string, labels: Record<string, string>, signal?: AbortSignal): Promise<void> {
  await docker(
    ["volume", "create", ...Object.entries(labels).flatMap(([k, v]) => ["--label", `${k}=${v}`]), name],
    { signal, label: "Create build volume" },
  );
}

export async function removeWorkspaceVolume(deploymentId: string, workerId: string): Promise<void> {
  await docker(["volume", "rm", "-f", workspaceVolumeName(deploymentId, workerId)], {
    timeoutMs: 30_000,
  }).catch(() => undefined);
}

interface ContainerRun {
  label: string;
  name: string;
  network: "bridge" | "none";
  command: string;
  timeoutMs: number;
  workdir: string;
  mounts: string[]; // docker --volume values
  env?: Record<string, string>;
  signal?: AbortSignal;
}

/** Runs one sandboxed step as the build user. */
async function runSandboxed(run: ContainerRun): Promise<string> {
  const args = [
    "run",
    "--name", run.name,
    "--init",
    "--network", run.network,
    "--user", env.BUILD_USER,
    "--read-only",
    "--memory", env.BUILD_MEMORY,
    "--memory-swap", env.BUILD_MEMORY,
    "--cpus", env.BUILD_CPUS,
    "--pids-limit", "512",
    "--security-opt", "no-new-privileges",
    "--cap-drop", "ALL",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
    ...run.mounts.flatMap((mount) => ["--volume", mount]),
    "--workdir", run.workdir,
    "--env", "HOME=/tmp",
    "--env", "CI=1",
    "--env", "NEXT_TELEMETRY_DISABLED=1",
    "--env", "npm_config_update_notifier=false",
    "--env", "npm_config_fund=false",
    "--env", "npm_config_audit=false",
    "--env", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    ...Object.entries(run.env ?? {}).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
    BUILD_IMAGE,
    "sh", "-c", `set -e; ${run.command}`,
  ];

  try {
    return await docker(args, { timeoutMs: run.timeoutMs, signal: run.signal, label: run.label });
  } finally {
    await removeContainer(run.name);
  }
}

// ============================================
// BUILD
// ============================================

export async function runDockerBuild(options: DockerBuildOptions): Promise<DockerBuildResult> {
  const { deploymentId, workerId, projectId, sourceDir, installCommand, buildCommand, signal } = options;
  const environment = options.environment ?? [];

  if (!installCommand.trim() || !buildCommand.trim()) {
    throw new Error("Install and build commands are required.");
  }

  const projectPath = toProjectPath(sourceDir, options.rootDir);
  const volume = workspaceVolumeName(deploymentId, workerId);
  const containerBase = `${BUILD_CONTAINER_PREFIX}${deploymentId}-${workerId}`;
  const startedAt = Date.now();
  const remaining = () => Math.max(1_000, BUILD_TIMEOUT - (Date.now() - startedAt));
  const projectDir = workspacePath(projectPath);

  // Shared dependency cache: npm/pnpm/yarn/corepack downloads are reused across builds.
  // Written only by the install step; mounted read-only where project code runs offline.
  const cacheEnv: Record<string, string> = {
    npm_config_cache: `${CACHE_MOUNT}/npm`,
    npm_config_prefer_offline: "true",
    npm_config_store_dir: `${CACHE_MOUNT}/pnpm-store`,
    YARN_CACHE_FOLDER: `${CACHE_MOUNT}/yarn`,
    COREPACK_HOME: `${CACHE_MOUNT}/corepack`,
  };

  await ensureVolume(volume, {
    "forgedeploy.workspace": "1",
    "forgedeploy.deployment": deploymentId,
    "forgedeploy.attempt": workerId,
  }, signal);
  await ensureVolume(env.BUILD_CACHE_VOLUME, { "forgedeploy.cache": "shared" }, signal);

  // Per-project build caches (e.g. .next/cache) persist between deployments.
  const projectCacheMounts: string[] = [];
  const prepareCacheMounts: string[] = [];
  // Mount points for project caches must exist in the workspace before Docker mounts
  // them; otherwise Docker creates the missing parents (e.g. .next) owned by root.
  const cacheMountPoints: string[] = [];

  for (const [index, cachePath] of (options.cachePaths ?? []).entries()) {
    const relative = toProjectPath(path.resolve(sourceDir, options.rootDir), cachePath);
    const cacheVolume = projectCacheVolumeName(projectId, relative);

    await ensureVolume(cacheVolume, { "forgedeploy.cache": "project", "forgedeploy.project": projectId }, signal);
    projectCacheMounts.push(`${cacheVolume}:${path.posix.join(projectDir, relative)}`);
    cacheMountPoints.push(path.posix.join(projectDir, relative));
    prepareCacheMounts.push(`${cacheVolume}:/project-cache/${index}`);
  }

  // Prepare step (trusted, runs no project code): copy the cloned source into the
  // volume and hand every build volume to the build user. New Docker volumes are
  // root-owned, so this runs as root with only the capabilities it needs.
  const owner = buildOwner();
  const ownVolumes =
    owner === "0:0"
      ? ""
      : ` && chown -R ${owner} ${WORKSPACE_MOUNT}` +
        ` && chown ${owner} ${CACHE_MOUNT}` +
        (prepareCacheMounts.length ? ` /project-cache/*` : "");

  try {
    await docker(
      [
        "run",
        "--name", `${containerBase}-prepare`,
        "--network", "none",
        "--security-opt", "no-new-privileges",
        "--cap-drop", "ALL",
        "--cap-add", "CHOWN",
        "--cap-add", "DAC_OVERRIDE",
        "--cap-add", "FOWNER",
        "--volume", `${path.resolve(sourceDir)}:/src:ro`,
        "--volume", `${volume}:${WORKSPACE_MOUNT}`,
        "--volume", `${env.BUILD_CACHE_VOLUME}:${CACHE_MOUNT}`,
        ...prepareCacheMounts.flatMap((mount) => ["--volume", mount]),
        BUILD_IMAGE,
        // cp -R (not -a): host ownership/timestamps from the Windows mount are not wanted.
        "sh", "-c",
        `set -e; cp -R /src/. ${WORKSPACE_MOUNT}/ && rm -rf ${WORKSPACE_MOUNT}/.git` +
          (cacheMountPoints.length ? ` && mkdir -p ${cacheMountPoints.map((p) => `'${p}'`).join(" ")}` : "") +
          ownVolumes,
      ],
      { timeoutMs: remaining(), signal, label: "Workspace preparation" },
    );
  } finally {
    await removeContainer(`${containerBase}-prepare`);
  }

  // Project env vars go in a read-only mount outside the workspace, so they
  // never end up in build output or the runtime image, and only the build step loads them.
  let secretsDir: string | undefined;
  let buildStep = buildCommand;

  if (environment.length > 0) {
    secretsDir = `${path.resolve(sourceDir)}.secrets`;
    await fs.mkdir(secretsDir, { recursive: true });
    await fs.writeFile(path.join(secretsDir, "env.sh"), toShellExports(environment), { mode: 0o600 });
    buildStep = `. ${SECRETS_MOUNT}/env.sh; ${buildCommand}`;
  }

  const phases: DockerBuildPhaseOutput[] = [];

  try {
    if (env.BUILD_NETWORK_ISOLATION) {
      phases.push({
        stage: "INSTALL",
        output: await runSandboxed({
          label: "Dependency installation",
          name: `${containerBase}-install`,
          network: "bridge",
          command: installCommand,
          timeoutMs: remaining(),
          workdir: projectDir,
          mounts: [`${volume}:${WORKSPACE_MOUNT}`, `${env.BUILD_CACHE_VOLUME}:${CACHE_MOUNT}`],
          env: cacheEnv,
          signal,
        }),
      });

      phases.push({
        stage: "BUILD",
        output: await runSandboxed({
          label: "Build",
          name: `${containerBase}-build`,
          network: "none",
          command: buildStep,
          timeoutMs: remaining(),
          workdir: projectDir,
          mounts: [
            `${volume}:${WORKSPACE_MOUNT}`,
            `${env.BUILD_CACHE_VOLUME}:${CACHE_MOUNT}:ro`,
            ...projectCacheMounts,
            ...(secretsDir ? [`${secretsDir}:${SECRETS_MOUNT}:ro`] : []),
          ],
          env: cacheEnv,
          signal,
        }),
      });
    } else {
      phases.push({
        stage: "BUILD",
        output: await runSandboxed({
          label: "Docker build",
          name: `${containerBase}-build`,
          network: "bridge",
          command: `${installCommand} && ${buildStep}`,
          timeoutMs: remaining(),
          workdir: projectDir,
          mounts: [
            `${volume}:${WORKSPACE_MOUNT}`,
            `${env.BUILD_CACHE_VOLUME}:${CACHE_MOUNT}`,
            ...projectCacheMounts,
            ...(secretsDir ? [`${secretsDir}:${SECRETS_MOUNT}:ro`] : []),
          ],
          env: cacheEnv,
          signal,
        }),
      });
    }
  } catch (error) {
    // Build tools sometimes echo env values in errors; never persist them.
    throw new Error(redactSecrets(error instanceof Error ? error.message : String(error), environment));
  } finally {
    if (secretsDir) {
      await fs.rm(secretsDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const redactedPhases = phases.map((phase) => ({
    stage: phase.stage,
    output: redactSecrets(phase.output, environment),
  }));

  return {
    output: redactedPhases.map((phase) => phase.output).filter(Boolean).join("\n"),
    phases: redactedPhases,
    durationMs: Date.now() - startedAt,
    workspaceVolume: volume,
    projectPath,
  };
}

// ============================================
// STATIC OUTPUT EXPORT
// ============================================

/**
 * Copies <project>/<outputDir> from the workspace volume to a host folder
 * (only the built files, typically a few hundred, cross to the host).
 */
export async function exportBuildOutput(options: {
  deploymentId: string;
  workerId: string;
  projectPath: string;
  outputDir: string;
  hostDestination: string;
  signal?: AbortSignal;
}): Promise<void> {
  const outputPath = toProjectPath(
    path.resolve("/", options.projectPath),
    options.outputDir,
  );
  const source = workspacePath(options.projectPath, outputPath);
  const destination = path.resolve(options.hostDestination);

  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  try {
    await runSandboxed({
      label: "Build output export",
      name: `${BUILD_CONTAINER_PREFIX}${options.deploymentId}-${options.workerId}-export`,
      network: "none",
      // Exit 3 = output directory missing (reported as a non-retryable error).
      command: `[ -d '${source}' ] || exit 3; cp -R '${source}'/. /out/`,
      timeoutMs: 5 * 60 * 1000,
      workdir: WORKSPACE_MOUNT,
      mounts: [
        `${workspaceVolumeName(options.deploymentId, options.workerId)}:${WORKSPACE_MOUNT}:ro`,
        `${destination}:/out`,
      ],
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DockerCommandError && error.exitCode === 3) {
      throw new NonRetryableError(`Build completed but output directory was not found: ${options.outputDir}`);
    }

    throw error;
  }
}
