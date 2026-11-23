
import { Queue } from "bullmq";
import { redis } from "../../lib/redis.js";

export const DEPLOYMENT_QUEUE_NAME = "deployments";

export interface DeploymentJobData {
  deploymentId: string;
}

export const deploymentQueue = new Queue<DeploymentJobData>(
  DEPLOYMENT_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,

      backoff: {
        type: "exponential",
        delay: 95_000,
      },

      removeOnComplete: {
        age: 24 * 60 * 60,
        count: 1000,
      },

      removeOnFail: {
        age: 7 * 24 * 60 * 60,
      },
    },
  },
);

export async function enqueueDeployment(deploymentId: string) {
  return deploymentQueue.add(
    "deploy",
    { deploymentId },
    {
      jobId: deploymentId,
    },
  );
}


export async function removeQueuedDeployment(deploymentId: string) {
  const job = await deploymentQueue.getJob(deploymentId);

  if (!job) {
    return false;
  }

  const state = await job.getState();

  // An active job cannot be removed safely.
  // The worker will check MongoDB status before processing.
  if (state === "active") {
    return false;
  }

  await job.remove();

  return true;
}

