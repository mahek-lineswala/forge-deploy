import type { Deployment, Project } from "./types";

/**
 * Turns a deployment URL (https://<id>.example.com) into the project's custom URL
 * (https://<name>.example.com). Protocol and port are kept, so it also works locally.
 */
export function aliasUrl(deploymentUrl: string, subdomain: string): string {
  const url = new URL(deploymentUrl);
  const [, ...rest] = url.hostname.split(".");

  url.hostname = [subdomain, ...rest].join(".");

  return url.origin;
}

/** The address visitors should use: the custom name when set, else the deployment's own URL. */
export function liveUrl(project: Pick<Project, "subdomain">, live: Pick<Deployment, "deploymentUrl"> | undefined) {
  if (!live?.deploymentUrl) return null;

  return project.subdomain ? aliasUrl(live.deploymentUrl, project.subdomain) : live.deploymentUrl;
}
