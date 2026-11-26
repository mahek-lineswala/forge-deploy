import type { DeploymentStatus } from "../types/deployment.types.js";

/** Deployment is queued or being processed by a worker. */
export const ACTIVE_DEPLOYMENT_STATUSES: DeploymentStatus[] = [
  "QUEUED",
  "CLONING",
  "BUILDING",
  "DEPLOYING",
  "HEALTH_CHECK",
];

/** Deployment will never be processed again. */
export const TERMINAL_DEPLOYMENT_STATUSES: ReadonlySet<DeploymentStatus> = new Set<DeploymentStatus>([
  "READY",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);
