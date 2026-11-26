/**
 * Deployment state in MongoDB: worker leases, guarded status transitions,
 * publishing and superseding.
 */
import { ObjectId, type Filter } from "mongodb";

import { ACTIVE_DEPLOYMENT_STATUSES } from "../../constants/deployment-status.js";
import { COLLECTIONS } from "../../constants/collections.js";
import { getDatabase } from "../../lib/mongodb.js";

import type {
  DeploymentContext,
  DeploymentStatus,
  DeploymentDocument,
  ProjectDocument,
} from "../../types/deployment.types.js";


export const DEPLOYMENT_LEASE_DURATION_MS = 90_000;

export async function getDeploymentContext(
  deploymentId: string,
): Promise<DeploymentContext | null> {
  if (!ObjectId.isValid(deploymentId)) {
    return null;
  }

  const db = getDatabase();

  const deployment = await db
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .findOne({ _id: new ObjectId(deploymentId) });

  if (!deployment) {
    return null;
  }

  const project = await db
    .collection<ProjectDocument>(COLLECTIONS.projects)
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        status: {
          $in: [...ACTIVE_DEPLOYMENT_STATUSES],
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [...ACTIVE_DEPLOYMENT_STATUSES],
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .findOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [...ACTIVE_DEPLOYMENT_STATUSES],
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
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
    status: { $in: ["DEPLOYING", "HEALTH_CHECK"] },
  };

  if (workerId) {
    filter.workerId = workerId;
    filter.leaseExpiresAt = { $gt: new Date() };
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(filter, {
      $set: {
        status: "READY",
        deploymentUrl,
        updatedAt: new Date(),
      },
    });

  return result.matchedCount === 1;
}

export async function saveRuntimeContainerMetadata(
  deploymentId: string,
  containerId: string,
  port: number,
  workerId: string,
): Promise<boolean> {
  if (
    !ObjectId.isValid(deploymentId) ||
    !/^[a-f0-9]{12,64}$/i.test(containerId) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !workerId
  ) {
    return false;
  }

  const result = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: new Date() },
        status: { $in: ["DEPLOYING", "HEALTH_CHECK"] },
      },
      {
        $set: {
          deploymentType: "RUNTIME",
          runtimeContainerId: containerId,
          runtimePort: port,
          updatedAt: new Date(),
        },
      },
    );

  return result.matchedCount === 1;
}



/**
 * Keeps one live deployment per project: the newest READY one.
 * - Older READY deployments of the same project become SUPERSEDED.
 * - If a newer deployment is already READY (this one finished late),
 *   this deployment is superseded instead.
 * Safe when two publishes race: both orders converge on the newest.
 */
export async function supersedeOtherDeployments(
  deploymentId: string,
): Promise<{ supersededOlder: number; selfSuperseded: boolean }> {
  const collection = getDatabase().collection<DeploymentDocument>(
    COLLECTIONS.deployments,
  );

  const current = await collection.findOne(
    { _id: new ObjectId(deploymentId) },
    { projection: { projectId: 1, createdAt: 1 } },
  );

  if (!current) {
    return { supersededOlder: 0, selfSuperseded: false };
  }

  const now = new Date();

  const older = await collection.updateMany(
    {
      projectId: current.projectId,
      _id: { $ne: current._id },
      status: "READY",
      createdAt: { $lt: current.createdAt },
    },
    { $set: { status: "SUPERSEDED", updatedAt: now } },
  );

  const newerReady = await collection.findOne(
    {
      projectId: current.projectId,
      _id: { $ne: current._id },
      status: "READY",
      createdAt: { $gt: current.createdAt },
    },
    { projection: { _id: 1 } },
  );

  let selfSuperseded = false;

  if (newerReady) {
    const self = await collection.updateOne(
      { _id: current._id, status: "READY" },
      { $set: { status: "SUPERSEDED", updatedAt: now } },
    );

    selfSuperseded = self.modifiedCount === 1;
  }

  return { supersededOlder: older.modifiedCount, selfSuperseded };
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [...ACTIVE_DEPLOYMENT_STATUSES],
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
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .updateOne(
      {
        _id: new ObjectId(deploymentId),
        workerId,
        leaseExpiresAt: { $gt: now },
        status: {
          $in: [...ACTIVE_DEPLOYMENT_STATUSES],
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
          deploymentType: null,
          startCommand: null,
          runtimeContainerId: null,
          runtimePort: null,  
        },
      },
    );

  return result.modifiedCount === 1;
}
