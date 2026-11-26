/**
 * Health checks that request a deployment through Nginx using its Host header.
 */
import http from "node:http";

import { env } from "../../config/env.js";
import { getDeploymentHost } from "./domain.service.js";

const ATTEMPTS = 10;
// Server apps (e.g. `next start`) need a few seconds to boot after the container starts.
const RUNTIME_ATTEMPTS = 30;
const RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface ProbeResult {
  statusCode: number;
  contentType: string;
}

/**
 * Requests Nginx directly using the deployment's Host header.
 * This avoids depending on OS resolution of *.localhost.
 */
function probe(deploymentId: string): Promise<ProbeResult> {
  const base = new URL(env.DEPLOYMENT_BASE_URL);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname:
          base.hostname === "localhost" ? "127.0.0.1" : base.hostname,
        port: base.port || 80,
        path: "/",
        method: "GET",
        headers: {
          Host: getDeploymentHost(deploymentId),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (response) => {
        response.resume();

        resolve({
          statusCode: response.statusCode ?? 0,
          contentType: String(response.headers["content-type"] ?? ""),
        });
      },
    );

    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", reject);
    request.end();
  });
}

async function waitBeforeRetry(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, RETRY_DELAY_MS),
  );
}

export async function checkDeploymentHealth(
  deploymentId: string,
): Promise<void> {
  let lastProblem = "no response";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const result = await probe(deploymentId);

      if (
        result.statusCode === 200 &&
        result.contentType.includes("text/html")
      ) {
        return;
      }

      lastProblem = `HTTP ${result.statusCode} (${result.contentType || "no content-type"})`;
    } catch (error) {
      lastProblem =
        error instanceof Error ? error.message : String(error);
    }

    if (attempt < ATTEMPTS) {
      await waitBeforeRetry();
    }
  }

  throw new Error(
    `Health check failed after ${ATTEMPTS} attempts: ${lastProblem}. Is Nginx running on ${env.DEPLOYMENT_BASE_URL}?`,
  );
}

export async function checkRuntimeDeploymentHealth(
  deploymentId: string,
): Promise<void> {
  let lastProblem = "no response";

  for (let attempt = 1; attempt <= RUNTIME_ATTEMPTS; attempt += 1) {
    try {
      const result = await probe(deploymentId);

      if (result.statusCode >= 200 && result.statusCode < 300) {
        return;
      }

      lastProblem = `HTTP ${result.statusCode} (${result.contentType || "no content-type"})`;
    } catch (error) {
      lastProblem =
        error instanceof Error ? error.message : String(error);
    }

    if (attempt < RUNTIME_ATTEMPTS) {
      await waitBeforeRetry();
    }
  }

  throw new Error(
    `Runtime health check failed after ${RUNTIME_ATTEMPTS} attempts: ${lastProblem}. Is the runtime container running and reachable through Nginx?`,
  );
}
