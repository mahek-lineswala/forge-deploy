
import { ObjectId } from "mongodb";

import { getDatabase } from "../lib/mongodb.js";
import { decryptSecret } from "../lib/encryption.js";
import { NonRetryableError } from "../utils/errors.js";

import type {
  ProjectDocument,
  GitHubConnectionDocument,
} from "../types/deployment.types.js";

export interface GitHubRepositoryAccess {
  repositoryUrl: string;
  accessToken: string;
  branch: string;
}

function decryptAccessToken(encryptedValue: string): string {
  return decryptSecret(encryptedValue, "GitHub access token");
}

function normalizeRepositoryUrl(repository: string): string {
  const trimmed = repository.trim();

  const normalized = trimmed.startsWith("https://")
    ? trimmed
    : `https://github.com/${trimmed.replace(/^\/+/, "")}`;

  const url = new URL(normalized);

  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com"
  ) {
    throw new NonRetryableError("Only GitHub HTTPS repositories are supported.");
  }

  const segments = url.pathname
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);

  if (segments.length !== 2) {
    throw new NonRetryableError("Invalid GitHub repository URL.");
  }

  return `https://github.com/${segments[0]}/${segments[1]}.git`;
}

export async function getGitHubRepositoryAccess(
  project: ProjectDocument,
): Promise<GitHubRepositoryAccess> {
  const userId = project.userId;

  if (!ObjectId.isValid(userId)) {
    throw new NonRetryableError("Invalid project owner ID.");
  }

  const connection = await getDatabase()
    .collection<GitHubConnectionDocument>("GitHubConnection")
    .findOne({
      userId,
    });

  if (!connection) {
    throw new NonRetryableError(
      "The project owner has not connected a GitHub account.",
    );
  }

  const accessToken = decryptAccessToken(
    connection.encryptedAccessToken,
  );

  return {
    repositoryUrl: normalizeRepositoryUrl(project.repository),
    accessToken,
    branch: project.branch,
  };
}
