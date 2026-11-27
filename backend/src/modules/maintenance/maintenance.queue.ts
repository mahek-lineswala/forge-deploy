import { Queue } from "bullmq";
import { redis } from "../../lib/redis.js";

/**
 * Jobs the deployment worker runs after the API has changed the database:
 * releasing everything a deleted deployment/project occupied, and pointing a
 * project's custom subdomain at its latest live deployment.
 *
 * Both are also repaired by the worker's janitor, so a lost job only delays the cleanup.
 */
export const MAINTENANCE_QUEUE_NAME = "maintenance";

export type MaintenanceJobData =
  | { type: "remove-deployments"; deploymentIds: string[] }
  | { type: "sync-alias"; projectId: string; previousSubdomain?: string | null };

export const maintenanceQueue = new Queue<MaintenanceJobData>(MAINTENANCE_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: { age: 24 * 60 * 60, count: 500 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  },
});

/** Never throws: the database change already happened and the janitor catches up. */
export async function enqueueRemoveDeployments(deploymentIds: string[], delayMs = 0): Promise<void> {
  if (deploymentIds.length === 0) return;

  try {
    await maintenanceQueue.add("remove-deployments", { type: "remove-deployments", deploymentIds }, { delay: delayMs });
  } catch (error) {
    console.error("Could not queue deployment cleanup; the worker janitor will remove the leftovers:", error);
  }
}

export async function enqueueSyncAlias(
  projectId: string,
  previousSubdomain?: string | null,
  delayMs = 0,
): Promise<void> {
  try {
    await maintenanceQueue.add(
      "sync-alias",
      { type: "sync-alias", projectId, previousSubdomain: previousSubdomain ?? null },
      { delay: delayMs },
    );
  } catch (error) {
    console.error("Could not queue subdomain sync; the worker janitor will repair it:", error);
  }
}
