
import { ObjectId } from "mongodb";
import { getDatabase } from "../lib/mongodb.js";

export type DeploymentLogLevel = "INFO" | "WARN" | "ERROR";

export type DeploymentLogStage =
  | "CLONE"
  | "INSTALL"
  | "BUILD"
  | "DEPLOY"
  | "HEALTH_CHECK"
  | "SYSTEM";

const DEPLOYMENT_LOGS_COLLECTION = "DeploymentLog";
const MAX_MESSAGE_LENGTH = 10_000;

interface WriteDeploymentLogOptions {
  deploymentId: string;
  stage: DeploymentLogStage;
  message: string;
  level?: DeploymentLogLevel;
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

  await database.collection(DEPLOYMENT_LOGS_COLLECTION).insertOne({
    deploymentId: new ObjectId(deploymentId),
    stage,
    level,
    message: normalizedMessage,
    createdAt: new Date(),
  });
}
