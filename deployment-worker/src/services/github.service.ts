
import { createDecipheriv } from "node:crypto";

import { ObjectId } from "mongodb";

import { env } from "../config/env.js";
import { getDatabase } from "../lib/mongodb.js";
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
  const parts = encryptedValue.split(":");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new NonRetryableError("Invalid encrypted GitHub access token format.");
  }

  const [, ivHex, authTagHex, ciphertextHex] = parts;

  const key = Buffer.from(env.ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex!, "hex");
  const authTag = Buffer.from(authTagHex!, "hex");
  const ciphertext = Buffer.from(ciphertextHex!, "hex");

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);

    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong ENCRYPTION_KEY or corrupted value: retrying cannot help.
    throw new NonRetryableError(
      "Could not decrypt the GitHub access token. Check that backend and worker use the same ENCRYPTION_KEY.",
    );
  }
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
