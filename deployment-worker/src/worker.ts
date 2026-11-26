/**
 * BullMQ consumer for the "deployments" queue. Per job it claims the MongoDB lease,
 * keeps it renewed, watches for cancellation, runs the pipeline and decides whether
 * a failure is retried.
 */
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { env } from "./config/env.js";
import { TERMINAL_DEPLOYMENT_STATUSES } from "./constants/deployment-status.js";
import { redis } from "./lib/redis.js";

import { processDeployment } from "./processors/deployment.processor.js";

import {
  claimDeploymentLease,
  renewDeploymentLease,
  releaseDeploymentLease,
  markDeploymentFailed,
  getDeploymentStatus,
} from "./services/deployment/deployment.service.js";

import type { DeploymentJobData } from "./types/deployment.types.js";
import { isNonRetryableError } from "./utils/errors.js";
import { isDeploymentId } from "./utils/deployment-id.js";

export const DEPLOYMENT_QUEUE_NAME = "deployments";

const LEASE_RENEWAL_INTERVAL_MS = 30_000;

// How quickly a user cancel stops a running clone/build.
const CANCEL_POLL_INTERVAL_MS = 5_000;

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

      if (status && TERMINAL_DEPLOYMENT_STATUSES.has(status)) {
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

    // Aborting kills the running git/docker process (docker rm -f removes the container).
    const abortController = new AbortController();

    const cancelTimer = setInterval(async () => {
      if (abortController.signal.aborted) return;

      try {
        if ((await getDeploymentStatus(deploymentId)) === "CANCELLED") {
          console.log(`[Worker] Deployment ${deploymentId} was cancelled. Stopping.`);
          abortController.abort();
        }
      } catch {
        // Status check failures are handled by lease renewal.
      }
    }, CANCEL_POLL_INTERVAL_MS);

    cancelTimer.unref();

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
          abortController.abort();

          console.error(
            `[Worker] Lease lost for deployment ${deploymentId}.`,
          );
        }
      } catch (error) {
        // A failed renewal means ownership can no longer be trusted.
        leaseLost = true;
        abortController.abort();

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
        abortController.signal,
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
      const status = await getDeploymentStatus(deploymentId).catch(() => null);

      if (status === "CANCELLED" && isDeploymentId(deploymentId)) {
        // Cancelled is terminal: nobody will publish this deployment again,
        // so remove anything it already published and stop retrying.
        await fs
          .rm(path.resolve(env.DEPLOYMENTS_DIR, deploymentId), {
            recursive: true,
            force: true,
          })
          .catch(() => undefined);

        throw new UnrecoverableError(`Deployment ${deploymentId} was cancelled.`);
      }

      const attempts = job.opts.attempts ?? 1;
      const nonRetryable = isNonRetryableError(error);
      const finalAttempt =
        nonRetryable || job.attemptsMade + 1 >= attempts;

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

      if (nonRetryable) {
        // Tells BullMQ to fail the job now and skip remaining attempts.
        throw new UnrecoverableError(error.message);
      }

      throw error;
    } finally {
      clearInterval(leaseTimer);
      clearInterval(cancelTimer);

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
