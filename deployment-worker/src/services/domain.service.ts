import { env } from "../config/env.js";

export function generateDeploymentUrl(
  deploymentId: string,
): string {
  if (!/^[a-fA-F0-9]{24}$/.test(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  const baseUrl = env.DEPLOYMENT_BASE_URL.replace(/\/+$/, "");

  return `${baseUrl}/${deploymentId}`;
}