import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Thin wrapper around the Docker CLI used by every Docker-related service. */

const execFileAsync = promisify(execFile);

const MAX_LOG_BUFFER = 20 * 1024 * 1024;

export class DockerCommandError extends Error {
  constructor(message: string, public readonly exitCode: number | null) {
    super(message);
    this.name = "DockerCommandError";
  }
}

type ExecError = Error & {
  stdout?: string;
  stderr?: string;
  killed?: boolean;
  code?: string | number;
};

export async function docker(
  args: string[],
  options: { timeoutMs?: number; signal?: AbortSignal; label?: string } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 60_000;

  try {
    const { stdout, stderr } = await execFileAsync("docker", args, {
      timeout: timeoutMs,
      maxBuffer: MAX_LOG_BUFFER,
      windowsHide: true,
      signal: options.signal,
    });

    return [stdout, stderr].filter(Boolean).join("\n");
  } catch (error) {
    const execError = error as ExecError;
    const logs = [execError.stdout, execError.stderr].filter(Boolean).join("\n");
    const label = options.label ?? `docker ${args[0]}`;

    if (options.signal?.aborted) {
      throw new Error(`${label} cancelled.\n${logs}`);
    }

    if (execError.killed) {
      throw new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} s.\n${logs}`);
    }

    // `docker run` exits with the container's exit code.
    throw new DockerCommandError(
      `${label} failed: ${execError.message}\n${logs}`,
      typeof execError.code === "number" ? execError.code : null,
    );
  }
}
