
import { ObjectId } from "mongodb";
import { getDatabase } from "../lib/mongodb.js";

const DEPLOYMENTS_COLLECTION = "Deployment";

interface BuildMetadata {
  framework: string;
  buildCommand: string;
  packageManager: string;
  outputDir: string;
  buildDurationMs?: number;
}

export async function saveBuildMetadata(
  deploymentId: string,
  metadata: BuildMetadata,
): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  await getDatabase()
    .collection(DEPLOYMENTS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(deploymentId) },
      {
        $set: {
          framework: metadata.framework,
          buildCommand: metadata.buildCommand,
          packageManager: metadata.packageManager,
          outputDir: metadata.outputDir,
          ...(metadata.buildDurationMs !== undefined
            ? { buildDurationMs: metadata.buildDurationMs }
            : {}),
          updatedAt: new Date(),
        },
        $min: {
          startedAt: new Date(),
        },
      },
    );
}

export async function saveBuildFailure(
  deploymentId: string,
  errorMessage: string,
): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  await getDatabase()
    .collection(DEPLOYMENTS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(deploymentId) },
      {
        $set: {
          errorMessage: errorMessage.slice(0, 10_000),
          updatedAt: new Date(),
        },
      },
    );
}

export async function completeBuildMetadata(
  deploymentId: string,
  durationMs: number,
): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  await getDatabase()
    .collection(DEPLOYMENTS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(deploymentId) },
      {
        $set: {
          buildDurationMs: durationMs,
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: {
          errorMessage: "",
        },
      },
    );
}

export async function completeDeploymentMetadata(
  deploymentId: string,
): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  await getDatabase()
    .collection(DEPLOYMENTS_COLLECTION)
    .updateOne(
      { _id: new ObjectId(deploymentId), status: "READY" },
      {
        $set: {
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
        $unset: {
          errorMessage: "",
        },
      },
    );
}

