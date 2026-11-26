/**
 * Writes deployment log lines (shown in the dashboard) to MongoDB.
 */
import { ObjectId } from "mongodb";
import { COLLECTIONS } from "../../constants/collections.js";
import { getDatabase } from "../../lib/mongodb.js";

export type DeploymentLogLevel = "INFO" | "WARN" | "ERROR";

export type DeploymentLogStage =
  | "CLONE"
  | "INSTALL"
  | "BUILD"
  | "DEPLOY"
  | "HEALTH_CHECK"
  | "SYSTEM";

const MAX_MESSAGE_LENGTH = 10_000;

interface WriteDeploymentLogOptions {
  deploymentId: string;
  stage: DeploymentLogStage;
  message: string;
  level?: DeploymentLogLevel;
}

/**
 * Same as writeDeploymentLog, but never throws: a log write must not fail a deployment.
 */
export async function writeDeploymentLogSafely(
  deploymentId: string,
  message: string,
  level: DeploymentLogLevel = "INFO",
  stage: DeploymentLogStage = "DEPLOY",
): Promise<void> {
  try {
    await writeDeploymentLog({ deploymentId, stage, message, level });
  } catch (error) {
    console.error("Could not persist deployment log:", error);
  }
}

export async function writeDeploymentLog({
  deploymentId,
  stage,
  message,
  level = "INFO",
}: WriteDeploymentLogOptions): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) {
    throw new Error("Invalid deployment ID for logging.");
  }

  const normalizedMessage = message.trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!normalizedMessage) {
    return;
  }

  const database = getDatabase();

  await database.collection(COLLECTIONS.deploymentLogs).insertOne({
    deploymentId: new ObjectId(deploymentId),
    stage,
    level,
    message: normalizedMessage,
    createdAt: new Date(),
  });
}
