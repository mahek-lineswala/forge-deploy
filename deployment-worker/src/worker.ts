
import { Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";

import { redis } from "./lib/redis.js";
import { env } from "./config/env.js";

import { processDeployment } from "./processors/deployment.processor.js";

import {
  claimDeploymentLease,
  renewDeploymentLease,
  releaseDeploymentLease,
  markDeploymentFailed,
  getDeploymentStatus,
} from "./services/deployment.service.js";

import type { DeploymentJobData } from "./types/deployment.types.js";

export const DEPLOYMENT_QUEUE_NAME = "deployments";

const LEASE_RENEWAL_INTERVAL_MS = 30_000;

const TERMINAL_STATUSES = new Set([
  "READY",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);

export const deploymentWorker = new Worker<DeploymentJobData>(
  DEPLOYMENT_QUEUE_NAME,
  async (job: Job<DeploymentJobData>) => {
    const { deploymentId } = job.data;

    if (!deploymentId) {
      throw new Error("Deployment ID is missing from the job.");
    }

    const workerId = randomUUID();

    console.log(
      `[Worker] Processing job ${job.id} for deployment ${deploymentId}`,
    );

    const claimed = await claimDeploymentLease(
      deploymentId,
      workerId,
    );

    if (!claimed) {
      const status = await getDeploymentStatus(deploymentId);

      if (status && TERMINAL_STATUSES.has(status)) {
        console.log(
          `[Worker] Deployment ${deploymentId} is already ${status}. Skipping.`,
        );

        return;
      }

      // Never complete a job merely because another worker may own its lease.
      throw new Error(
        `Could not acquire deployment lease for ${deploymentId}.`,
      );
    }

    let leaseLost = false;
    let renewalInProgress = false;

    const leaseTimer = setInterval(async () => {
      if (renewalInProgress || leaseLost) {
        return;
      }

      renewalInProgress = true;

      try {
        const renewed = await renewDeploymentLease(
          deploymentId,
          workerId,
        );

        if (!renewed) {
          leaseLost = true;

          console.error(
            `[Worker] Lease lost for deployment ${deploymentId}.`,
          );
        }
      } catch (error) {
        // A failed renewal means ownership can no longer be trusted.
        leaseLost = true;

        console.error(
          `[Worker] Lease renewal failed for ${deploymentId}:`,
          error,
        );
      } finally {
        renewalInProgress = false;
      }
    }, LEASE_RENEWAL_INTERVAL_MS);

    leaseTimer.unref();

    try {
      await processDeployment(
        deploymentId,
        workerId,
        () => leaseLost,
      );

      if (leaseLost) {
        throw new Error(
          `Worker lost its lease while processing deployment ${deploymentId}.`,
        );
      }

      console.log(
        `[Worker] Finished job ${job.id} for deployment ${deploymentId}`,
      );
    } catch (error) {
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;

      if (finalAttempt && !leaseLost) {
        try {
          await markDeploymentFailed(
            deploymentId,
            error instanceof Error
              ? error.message
              : "Unknown deployment error",
            workerId,
          );
        } catch (failureError) {
          console.error(
            `[Worker] Could not mark deployment ${deploymentId} as failed:`,
            failureError,
          );
        }
      }

      throw error;
    } finally {
      clearInterval(leaseTimer);

      try {
        await releaseDeploymentLease(deploymentId, workerId);
      } catch (error) {
        console.error(
          `[Worker] Could not release lease for ${deploymentId}:`,
          error,
        );
      }
    }
  },
    {
    connection: redis,
    concurrency: env.MAX_CONCURRENT_DEPLOYMENTS,
    autorun: false,
  },
);

deploymentWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully.`);
});

deploymentWorker.on("failed", (job, error) => {
  console.error(
    `[Worker] Job ${job?.id ?? "unknown"} failed: ${error.message}`,
  );
});

deploymentWorker.on("error", (error) => {
  console.error("[Worker] BullMQ error:", error);
});

deploymentWorker.on("stalled", (jobId) => {
  console.warn(`[Worker] Job ${jobId} stalled.`);
});

console.log(
  `[Worker] Listening on "${DEPLOYMENT_QUEUE_NAME}" with concurrency ${env.MAX_CONCURRENT_DEPLOYMENTS}`,
);
