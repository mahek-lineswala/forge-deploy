/** Deployment IDs are MongoDB ObjectIds in lowercase hex. They are also used in paths, hostnames and Docker names. */
const DEPLOYMENT_ID_PATTERN = /^[a-f0-9]{24}$/;

export function isDeploymentId(value: string): boolean {
  return DEPLOYMENT_ID_PATTERN.test(value);
}

export function assertDeploymentId(value: string): void {
  if (!isDeploymentId(value)) {
    throw new Error("Invalid deployment ID.");
  }
}
