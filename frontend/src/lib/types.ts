// Shapes returned by the ForgeDeploy backend (see backend/src/modules/*/ *.schema.ts).

export interface User {
  id: string;
  name: string | null;
  email: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  repository: string; // "owner/repo"
  repositoryId: string | null;
  branch: string;
  framework: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  rootDir: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectFramework = "vite" | "nextjs" | "node" | "python";

export interface ProjectInput {
  name: string;
  repository: string;
  repositoryId?: string | null;
  branch?: string;
  framework?: ProjectFramework | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  outputDir?: string | null;
  rootDir?: string;
}

export const DEPLOYMENT_STATUSES = [
  "QUEUED",
  "CLONING",
  "BUILDING",
  "DEPLOYING",
  "HEALTH_CHECK",
  "READY",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const ACTIVE_STATUSES: readonly DeploymentStatus[] = [
  "QUEUED",
  "CLONING",
  "BUILDING",
  "DEPLOYING",
  "HEALTH_CHECK",
];

export const isActiveStatus = (status: DeploymentStatus) =>
  ACTIVE_STATUSES.includes(status);

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  commitSha: string | null;
  commitMessage: string | null;
  deploymentUrl: string | null;
  projectId: string;
  framework?: string | null;
  packageManager?: string | null;
  buildCommand?: string | null;
  outputDir?: string | null;
  buildDurationMs?: number | null;
  errorMessage?: string | null;
  attempts?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LogStage =
  | "CLONE"
  | "INSTALL"
  | "BUILD"
  | "DEPLOY"
  | "HEALTH_CHECK"
  | "SYSTEM";

export interface DeploymentLog {
  id: string;
  stage: LogStage | string;
  level: "INFO" | "WARN" | "ERROR" | string;
  message: string;
  createdAt: string;
}

export interface DeploymentLogsPage {
  logs: DeploymentLog[];
  nextCursor: string | null;
  status: DeploymentStatus;
  finished: boolean;
}

export interface EnvironmentVariable {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubAccount {
  githubUserId: string;
  githubUsername: string;
  avatarUrl: string | null;
  scopes: string[];
  connectedAt: string;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  description: string | null;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
  owner: string;
  ownerAvatarUrl: string;
}

export interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}
