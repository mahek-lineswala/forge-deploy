/** MongoDB collection names shared with the backend's Prisma models. */
export const COLLECTIONS = {
  deployments: "Deployment",
  deploymentLogs: "DeploymentLog",
  projects: "Project",
  environmentVariables: "EnvironmentVariable",
  gitHubConnections: "GitHubConnection",
} as const;
