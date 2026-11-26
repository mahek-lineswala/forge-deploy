/**
 * Build/deployment metadata fields on the Deployment document.
 */
import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { getDatabase } from "../../lib/mongodb.js";


interface BuildMetadata {
  framework: string;
  buildCommand: string;
  packageManager: string;
  outputDir: string;
  deploymentType?: "STATIC" | "RUNTIME";
  startCommand?: string | null;
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
    .collection(COLLECTIONS.deployments)
    .updateOne(
      { _id: new ObjectId(deploymentId) },
      {
        $set: {
          framework: metadata.framework,
          buildCommand: metadata.buildCommand,
          packageManager: metadata.packageManager,
          outputDir: metadata.outputDir,
          ...(metadata.deploymentType !== undefined
            ? { deploymentType: metadata.deploymentType }
            : {}),
          ...(metadata.startCommand !== undefined
            ? { startCommand: metadata.startCommand }
            : {}),
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
    .collection(COLLECTIONS.deployments)
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

export async function completeDeploymentMetadata(
  deploymentId: string,
): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID.");
  }

  await getDatabase()
    .collection(COLLECTIONS.deployments)
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
