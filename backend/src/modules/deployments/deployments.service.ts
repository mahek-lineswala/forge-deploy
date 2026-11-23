
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import { enqueueDeployment, removeQueuedDeployment } from "./deployments.queue.js";
import type { CreateDeploymentBody } from "./deployments.schema.js";

// ============================================
// PROJECT OWNERSHIP
// ============================================

async function ensureProjectOwnership(
  userId: string,
  projectId: string
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new AppError(404, "Project not found");
  }

  return project;
}

// ============================================
// CREATE DEPLOYMENT
// ============================================

export async function createDeployment(
  userId: string,
  projectId: string,
  body: CreateDeploymentBody
) {
  await ensureProjectOwnership(userId, projectId);

  const deployment = await prisma.deployment.create({
    data: {
      projectId,
      commitSha: body.commitSha ?? null,
      commitMessage: body.commitMessage ?? null,
    },
  });

  try {
    await enqueueDeployment(deployment.id);
  } catch {
    // Mark the deployment as failed if it could not
    // be added to the execution queue.
    await prisma.deployment.update({
      where: {
        id: deployment.id,
      },
      data: {
        status: "FAILED",
      },
    });

    throw new AppError(
      503,
      "Deployment could not be added to the queue"
    );
  }

  return deployment;
}

// ============================================
// LIST PROJECT DEPLOYMENTS
// ============================================

export async function listDeploymentsForProject(
  userId: string,
  projectId: string
) {
  await ensureProjectOwnership(userId, projectId);

  const deployments = await prisma.deployment.findMany({
    where: {
      projectId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 100,
  });

  return deployments;
}

// ============================================
// GET SINGLE DEPLOYMENT
// ============================================

export async function getDeploymentForUser(
  userId: string,
  deploymentId: string
) {
  const deployment = await prisma.deployment.findUnique({
    where: {
      id: deploymentId,
    },
  });

  if (!deployment) {
    throw new AppError(404, "Deployment not found");
  }

  await ensureProjectOwnership(userId, deployment.projectId);

  return deployment;
}

// ============================================
// CANCEL DEPLOYMENT
// ============================================

export async function cancelDeployment(
  userId: string,
  deploymentId: string
) {
  const deployment = await getDeploymentForUser(
    userId,
    deploymentId
  );

  if (deployment.status !== "QUEUED") {
    throw new AppError(
      409,
      "Only queued deployments can be cancelled"
    );
  }
  // Remove the pending BullMQ job.
// If the job is already active, the worker must check
// MongoDB and skip it because its status is CANCELLED.
try {
  await removeQueuedDeployment(deploymentId);
} catch (error) {
  console.error(
    "Failed to remove cancelled deployment from BullMQ:",
    error
  );
}

  const result = await prisma.deployment.updateMany({
    where: {
      id: deploymentId,
      status: "QUEUED",
    },
    data: {
      status: "CANCELLED",
    },
  });

  if (result.count === 0) {
    throw new AppError(
      409,
      "Deployment status changed and it could not be cancelled"
    );
  }

  const updatedDeployment = await prisma.deployment.findUnique({
    where: {
      id: deploymentId,
    },
  });

  if (!updatedDeployment) {
    throw new AppError(404, "Deployment not found");
  }

  return updatedDeployment;
}
