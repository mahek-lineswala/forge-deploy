import http from "node:http";

import { env } from "../config/env.js";
import { getDeploymentHost } from "./domain.service.js";

const ATTEMPTS = 10;
const RETRY_DELAY_MS = 1_000;
const REQUEST_TIMEOUT_MS = 5_000;

interface ProbeResult {
  statusCode: number;
  contentType: string;
}

/**
 * Requests the base URL's host:port directly with the deployment's Host header,
 * so the check does not depend on the OS resolving *.localhost.
 */
function probe(deploymentId: string): Promise<ProbeResult> {
  const base = new URL(env.DEPLOYMENT_BASE_URL);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: base.hostname === "localhost" ? "127.0.0.1" : base.hostname,
        port: base.port || 80,
        path: "/",
        method: "GET",
        headers: { Host: getDeploymentHost(deploymentId) },
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

export async function checkDeploymentHealth(deploymentId: string): Promise<void> {
  let lastProblem = "no response";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const result = await probe(deploymentId);

      if (result.statusCode === 200 && result.contentType.includes("text/html")) {
        return;
      }

      lastProblem = `HTTP ${result.statusCode} (${result.contentType || "no content-type"})`;
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }

  throw new Error(
    `Health check failed after ${ATTEMPTS} attempts: ${lastProblem}. Is Nginx running on ${env.DEPLOYMENT_BASE_URL}?`,
  );
}
