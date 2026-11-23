
import { ObjectId, type Filter } from "mongodb";

import { getDatabase } from "../lib/mongodb.js";

import type {
  DeploymentContext,
  DeploymentStatus,
  DeploymentDocument,
  ProjectDocument,
} from "../types/deployment.types.js";

const DEPLOYMENTS_COLLECTION = "Deployment";
const PROJECTS_COLLECTION = "Project";

export const DEPLOYMENT_LEASE_DURATION_MS = 90_000;

export async function getDeploymentContext(
  deploymentId: string,
): Promise<DeploymentContext | null> {
  if (!ObjectId.isValid(deploymentId)) {
    return null;
  }

  const db = getDatabase();

  const deployment = await db
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .findOne({ _id: new ObjectId(deploymentId) });

  if (!deployment) {
    return null;
  }

  const project = await db
    .collection<ProjectDocument>(PROJECTS_COLLECTION)
    .findOne({ _id: deployment.projectId });

  if (!project) {
    return null;
  }

  return { deployment, project };
}

export async function getDeploymentStatus(
  deploymentId: string,
): Promise<DeploymentStatus | null> {
  if (!ObjectId.isValid(deploymentId)) {
    return null;
  }

  const deployment = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .findOne(
      { _id: new ObjectId(deploymentId) },
      { projection: { status: 1 } },
    );

  return deployment?.status ?? null;
}

/**
 * Atomically claims an eligible deployment for one worker attempt.
 * Expired or absent leases can be reclaimed after a worker crash.
 */
export async function claimDeploymentLease(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const now = new Date();
  const leaseExpiresAt = new Date(
    now.getTime() + DEPLOYMENT_LEASE_DURATION_MS,
  );

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        status: {
          $in: [
            "QUEUED",
            "CLONING",
            "BUILDING",
            "DEPLOYING",
            "HEALTH_CHECK",
          ],
        },
        $or: [
          { workerId: null },
          { workerId: { $exists: false } },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $exists: false } },
          { leaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          workerId,
          claimedAt: now,
          leaseExpiresAt,
          updatedAt: now,
        },
        $inc: {
          attempts: 1,
        },
      },
    );

  return result.modifiedCount === 1;
}

/**
 * Extends the lease only while this worker still owns the deployment.
 */
export async function renewDeploymentLease(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const now = new Date();

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [
            "QUEUED",
            "CLONING",
            "BUILDING",
            "DEPLOYING",
            "HEALTH_CHECK",
          ],
        },
      },
      {
        $set: {
          leaseExpiresAt: new Date(
            now.getTime() + DEPLOYMENT_LEASE_DURATION_MS,
          ),
          updatedAt: now,
        },
      },
    );

  return result.matchedCount === 1;
}

/**
 * Checks that the worker still owns a non-expired lease.
 */
export async function ownsDeploymentLease(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const now = new Date();

  const deployment = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .findOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [
            "QUEUED",
            "CLONING",
            "BUILDING",
            "DEPLOYING",
            "HEALTH_CHECK",
          ],
        },
      },
      { projection: { _id: 1 } },
    );

  return deployment !== null;
}

/**
 * Releases ownership after the job attempt finishes.
 * Does not modify the deployment's current stage or status.
 */
export async function releaseDeploymentLease(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
      },
      {
        $set: {
          workerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        },
      },
    );

  return result.modifiedCount === 1;
}

export async function updateDeploymentStatus(
  deploymentId: string,
  status: DeploymentStatus,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const filter: Filter<DeploymentDocument> = {
    _id: new ObjectId(deploymentId),
  };

  if (workerId) {
    filter.workerId = workerId;
    filter.leaseExpiresAt = { $gt: new Date() };
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      filter,
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      },
    );

  return result.matchedCount === 1;
}

export async function claimDeploymentForCloning(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const filter: Filter<DeploymentDocument> = {
    _id: new ObjectId(deploymentId),
    status: { $in: ["QUEUED", "CLONING"] },
  };

  if (workerId) {
    filter.workerId = workerId;
    filter.leaseExpiresAt = { $gt: new Date() };
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(filter, {
      $set: {
        status: "CLONING",
        updatedAt: new Date(),
      },
    });

  return result.matchedCount === 1;
}

export async function claimDeploymentForBuilding(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const filter: Filter<DeploymentDocument> = {
    _id: new ObjectId(deploymentId),
    status: { $in: ["CLONING", "BUILDING"] },
  };

  if (workerId) {
    filter.workerId = workerId;
    filter.leaseExpiresAt = { $gt: new Date() };
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(filter, {
      $set: {
        status: "BUILDING",
        updatedAt: new Date(),
      },
    });

  return result.matchedCount === 1;
}

export async function publishDeploymentRecord(
  deploymentId: string,
  deploymentUrl: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId)) {
    return false;
  }

  const filter: Filter<DeploymentDocument> = {
    _id: new ObjectId(deploymentId),
    status: "DEPLOYING",
  };

  if (workerId) {
    filter.workerId = workerId;
    filter.leaseExpiresAt = { $gt: new Date() };
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(filter, {
      $set: {
        status: "READY",
        deploymentUrl,
        updatedAt: new Date(),
      },
    });

  return result.matchedCount === 1;
}


export async function markDeploymentFailed(
  deploymentId: string,
  errorMessage: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const now = new Date();

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [
            "QUEUED",
            "CLONING",
            "BUILDING",
            "DEPLOYING",
            "HEALTH_CHECK",
          ],
        },
      },
      {
        $set: {
          status: "FAILED",
          errorMessage: errorMessage.slice(0, 10_000),
          finishedAt: now,
          updatedAt: now,
          workerId: null,
          claimedAt: null,
          leaseExpiresAt: null,
        },
      },
    );

  if (result.modifiedCount === 1) {
    console.error(
      `Deployment ${deploymentId} failed: ${errorMessage}`,
    );
  }

  return result.modifiedCount === 1;
}


export async function restartDeploymentForAttempt(
  deploymentId: string,
  workerId: string,
): Promise<boolean> {
  if (!ObjectId.isValid(deploymentId) || !workerId) {
    return false;
  }

  const now = new Date();

  const result = await getDatabase()
    .collection<DeploymentDocument>(DEPLOYMENTS_COLLECTION)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [
            "QUEUED",
            "CLONING",
            "BUILDING",
            "DEPLOYING",
            "HEALTH_CHECK",
          ],
        },
      },
      {
        $set: {
          status: "CLONING",
          framework: null,
          buildCommand: null,
          packageManager: null,
          outputDir: null,
          buildDurationMs: null,
          errorMessage: null,
          deploymentUrl: null,
          startedAt: now,
          finishedAt: null,
          updatedAt: now,
        },
      },
    );

  return result.modifiedCount === 1;
}
