
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import { encrypt, decrypt } from "../../lib/encryption.js";
import { getGitHubAccessToken } from "./github.service.js";
import { enqueueDeployment } from "../deployments/deployments.queue.js";

type GitHubRepository = {
  full_name?: string;
};

type GitHubPushPayload = {
  ref?: string;
  deleted?: boolean;
  repository?: GitHubRepository;
  head_commit?: {
    id?: string;
    message?: string;
  } | null;
};

// ============================================
// REPOSITORY HELPERS
// ============================================

function parseGitHubRepository(repository: string) {
  const sshMatch = repository.match(
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  );

  if (sshMatch) {
    return {
      owner: sshMatch[1],
      name: sshMatch[2],
      fullName: `${sshMatch[1]}/${sshMatch[2]}`,
    };
  }

  try {
    const url = new URL(repository);

    if (url.hostname.toLowerCase() !== "github.com") {
      throw new Error("Invalid host");
    }

    const parts = url.pathname
      .replace(/\.git$/, "")
      .split("/")
      .filter(Boolean);

    if (parts.length !== 2) {
      throw new Error("Invalid repository path");
    }

    return {
      owner: parts[0],
      name: parts[1],
      fullName: `${parts[0]}/${parts[1]}`,
    };
  } catch {
    throw new AppError(
      400,
      "Project repository must be a valid GitHub repository URL",
    );
  }
}

function getWebhookUrl(projectId: string) {
  const baseUrl = process.env.GITHUB_WEBHOOK_URL?.replace(/\/+$/, "");

  if (!baseUrl) {
    throw new AppError(500, "GitHub webhook URL is not configured");
  }

  return `${baseUrl}/${projectId}`;
}

// ============================================
// GITHUB API
// ============================================

async function githubApiRequest(
  path: string,
  accessToken: string,
  method: "POST" | "PATCH" | "DELETE" = "POST",
  body?: unknown,
) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok && response.status !== 404) {
    const message = await response.text();

    throw new AppError(
      response.status === 401 ? 401 : 502,
      `GitHub API request failed: ${message.slice(0, 300)}`,
    );
  }

  return response;
}

// ============================================
// PROJECT OWNERSHIP
// ============================================

async function getOwnedProject(userId: string, projectId: string) {
  if (!/^[a-fA-F0-9]{24}$/.test(projectId)) {
    throw new AppError(400, "Invalid project ID");
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    include: {
      githubWebhook: true,
    },
  });

  if (!project) {
    throw new AppError(404, "Project not found");
  }

  return project;
}

// ============================================
// CREATE GITHUB WEBHOOK
// ============================================

export async function createProjectGitHubWebhook(
  userId: string,
  projectId: string,
) {
  const project = await getOwnedProject(userId, projectId);

  if (project.githubWebhook) {
    throw new AppError(
      409,
      "A GitHub webhook already exists for this project",
    );
  }

  const repository = parseGitHubRepository(project.repository);
  const accessToken = await getGitHubAccessToken(userId);
  const secret = randomBytes(32).toString("hex");
  const callbackUrl = getWebhookUrl(projectId);

  const response = await githubApiRequest(
    `/repos/${repository.owner}/${repository.name}/hooks`,
    accessToken,
    "POST",
    {
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: callbackUrl,
        content_type: "json",
        secret,
        insecure_ssl: "0",
      },
    },
  );

  const webhook = (await response.json()) as { id: number };

  try {
    await prisma.gitHubWebhook.create({
      data: {
        webhookId: webhook.id,
        encryptedSecret: encrypt(secret),
        projectId,
      },
    });
  } catch (error) {
    // Remove the remote webhook if local persistence fails.
    try {
      await githubApiRequest(
        `/repos/${repository.owner}/${repository.name}/hooks/${webhook.id}`,
        accessToken,
        "DELETE",
      );
    } catch {
      // Preserve the original database error.
    }

    throw error;
  }

  return {
    message: "GitHub webhook created successfully",
    webhookId: webhook.id,
    callbackUrl,
    repository: repository.fullName,
  };
}

// ============================================
// GITHUB WEBHOOK STATUS
// ============================================

export async function getProjectGitHubWebhookStatus(
  userId: string,
  projectId: string,
) {
  const project = await getOwnedProject(userId, projectId);

  return {
    enabled: Boolean(project.githubWebhook?.active),
    available: Boolean(process.env.GITHUB_WEBHOOK_URL),
  };
}

// ============================================
// DELETE GITHUB WEBHOOK
// ============================================

export async function deleteProjectGitHubWebhook(
  userId: string,
  projectId: string,
) {
  const project = await getOwnedProject(userId, projectId);
  const webhook = project.githubWebhook;

  if (!webhook) {
    throw new AppError(
      404,
      "No GitHub webhook is configured for this project",
    );
  }

  const repository = parseGitHubRepository(project.repository);
  const accessToken = await getGitHubAccessToken(userId);

  await githubApiRequest(
    `/repos/${repository.owner}/${repository.name}/hooks/${webhook.webhookId}`,
    accessToken,
    "DELETE",
  );

  await prisma.gitHubWebhook.delete({
    where: { projectId },
  });

  return {
    message: "GitHub webhook deleted successfully",
  };
}

// ============================================
// WEBHOOK SIGNATURE VERIFICATION
// ============================================

function verifyGitHubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
) {
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

// ============================================
// PRISMA ERROR HELPERS
// ============================================

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

// ============================================
// PROCESS GITHUB WEBHOOK
// ============================================

export async function processGitHubWebhook(
  projectId: string,
  rawBody: Buffer,
  signature: string | undefined,
  deliveryId: string | undefined,
  event: string | undefined,
) {
  if (!deliveryId || !event) {
    throw new AppError(400, "Missing GitHub webhook headers");
  }

  const webhook = await prisma.gitHubWebhook.findUnique({
    where: { projectId },
    include: {
      project: true,
    },
  });

  if (!webhook || !webhook.active) {
    throw new AppError(404, "GitHub webhook not found or inactive");
  }

  const secret = decrypt(webhook.encryptedSecret);

  if (!verifyGitHubSignature(rawBody, signature, secret)) {
    throw new AppError(401, "Invalid GitHub webhook signature");
  }

  let payload: GitHubPushPayload;

  try {
    payload = JSON.parse(rawBody.toString("utf8")) as GitHubPushPayload;
  } catch {
    throw new AppError(400, "Invalid webhook JSON payload");
  }

  // ==========================================
  // EVENT FILTERING (before anything is written)
  // ==========================================

  const project = webhook.project;
  let ignoreReason: string | null = null;

  if (event !== "push") {
    ignoreReason = "Event ignored";
  } else {
    const expectedRepository = parseGitHubRepository(project.repository);

    if (
      payload.repository?.full_name?.toLowerCase() !==
      expectedRepository.fullName.toLowerCase()
    ) {
      ignoreReason = "Repository mismatch";
    } else if (
      payload.ref !== `refs/heads/${project.branch}` ||
      payload.deleted === true
    ) {
      ignoreReason = "Branch does not match project configuration";
    }
  }

  if (ignoreReason) {
    // Record the delivery for auditing; duplicates are harmless here.
    try {
      await prisma.gitHubWebhookDelivery.create({
        data: { deliveryId, event, projectId },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { received: true, duplicate: true, deploymentCreated: false };
      }

      throw error;
    }

    return {
      received: true,
      duplicate: false,
      deploymentCreated: false,
      reason: ignoreReason,
    };
  }

  // ==========================================
  // DELIVERY + DEPLOYMENT IN ONE TRANSACTION
  // Either both exist or neither does, so a crash can no longer
  // record a delivery without its deployment. (Atlas = replica set.)
  // ==========================================

  let deployment;

  try {
    deployment = await prisma.$transaction(async (tx) => {
      await tx.gitHubWebhookDelivery.create({
        data: { deliveryId, event, projectId },
      });

      return tx.deployment.create({
        data: {
          status: "QUEUED",
          commitSha: payload.head_commit?.id ?? null,
          commitMessage: payload.head_commit?.message ?? null,
          projectId: project.id,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return { received: true, duplicate: true, deploymentCreated: false };
    }

    throw error;
  }

  // ==========================================
  // ADD DEPLOYMENT TO BULLMQ
  // If this fails (or the process dies here) the deployment stays QUEUED
  // and the reconciler enqueues it within ~2 minutes.
  // ==========================================

  try {
    await enqueueDeployment(deployment.id);
  } catch (error) {
    console.error(
      `Webhook deployment ${deployment.id} not enqueued yet; reconciler will retry:`,
      error,
    );
  }

  return {
    received: true,
    duplicate: false,
    deploymentCreated: true,
    deploymentId: deployment.id,
  };
}
