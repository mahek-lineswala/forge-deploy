import type { FastifyBaseLogger } from "fastify";

import { prisma } from "../../lib/prisma.js";
import { deploymentQueue, enqueueDeployment } from "./deployments.queue.js";

const INTERVAL_MS = 60_000;
// Give the normal request path time to enqueue before treating a job as missing.
const GRACE_PERIOD_MS = 60_000;
const BATCH_SIZE = 50;

/**
 * MongoDB is the outbox: every QUEUED deployment must have a BullMQ job.
 * This finds QUEUED deployments whose job is missing (process crashed after
 * the DB write, Redis was down, ...) and enqueues them. jobId = deploymentId,
 * so running this on several backend instances cannot create duplicates.
 */
export async function reconcileQueuedDeployments(
  log: FastifyBaseLogger
): Promise<number> {
  const stale = await prisma.deployment.findMany({
    where: {
      status: "QUEUED",
      createdAt: { lt: new Date(Date.now() - GRACE_PERIOD_MS) },
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let enqueued = 0;

  for (const { id } of stale) {
    const job = await deploymentQueue.getJob(id);

    if (job) continue;

    await enqueueDeployment(id);
    enqueued += 1;

    log.warn({ deploymentId: id }, "Re-enqueued QUEUED deployment with no queue job");
  }

  return enqueued;
}

export function startDeploymentReconciler(log: FastifyBaseLogger): () => void {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;

    try {
      await reconcileQueuedDeployments(log);
    } catch (error) {
      log.error(error, "Deployment reconciliation failed");
    } finally {
      running = false;
    }
  };

  void tick();

  const timer = setInterval(() => void tick(), INTERVAL_MS);
  timer.unref();

  return () => clearInterval(timer);
}
