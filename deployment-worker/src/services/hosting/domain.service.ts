/**
 * Deployment hostnames and public URLs.
 */
import { env } from "../../config/env.js";
import { assertDeploymentId } from "../../utils/deployment-id.js";

/**
 * Host name a deployment is served on: <deploymentId>.<base host>.
 * Subdomains (not /<id> paths) are used because Vite/CRA builds reference
 * assets from the site root (/assets/...), which breaks under a path prefix.
 */
export function getDeploymentHost(deploymentId: string): string {
  assertDeploymentId(deploymentId);

  return `${deploymentId}.${new URL(env.DEPLOYMENT_BASE_URL).hostname}`;
}

export function generateDeploymentUrl(deploymentId: string): string {
  const url = new URL(env.DEPLOYMENT_BASE_URL);

  url.hostname = getDeploymentHost(deploymentId);

  return url.origin;
}
