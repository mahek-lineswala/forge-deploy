
import type { ObjectId } from "mongodb";

export type DeploymentStatus =
  | "QUEUED"
  | "CLONING"
  | "BUILDING"
  | "DEPLOYING"
  | "HEALTH_CHECK"
  | "READY"
  | "FAILED"
  | "CANCELLED"
  | "SUPERSEDED";

export interface DeploymentDocument {
  _id: ObjectId;

  status: DeploymentStatus;

  commitSha: string | null;
  commitMessage: string | null;
  deploymentUrl: string | null;

  projectId: ObjectId;

  // Worker coordination
  workerId: string | null;
  claimedAt: Date | null;
  leaseExpiresAt: Date | null;
  attempts: number;

  // Build metadata
  framework: string | null;
  buildCommand: string | null;
  packageManager: string | null;
  outputDir: string | null;
  buildDurationMs: number | null;

  // Error and lifecycle metadata
  errorMessage: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDocument {
  _id: ObjectId;
  name: string;
  repository: string;
  repositoryId: string | null;
  branch: string;
  framework: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  rootDir: string;
  userId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeploymentJobData {
  deploymentId: string;
}

export interface DeploymentContext {
  deployment: DeploymentDocument;
  project: ProjectDocument;
}

export interface GitHubConnectionDocument {
  _id: ObjectId;
  userId: ObjectId;
  githubUsername: string;
  encryptedAccessToken: string;
}
