/**
 * BullMQ consumer for the "maintenance" queue, fed by the API when a deployment or
 * project is deleted or a project's subdomain changes.
 */
import { Worker, type Job } from "bullmq";

import { redis } from "./lib/redis.js";
import { syncProjectAlias } from "./services/hosting/alias.service.js";
import { removeDeploymentResources } from "./services/teardown.service.js";

export const MAINTENANCE_QUEUE_NAME = "maintenance";

export type MaintenanceJobData =
  | { type: "remove-deployments"; deploymentIds: string[] }
  | { type: "sync-alias"; projectId: string; previousSubdomain?: string | null };

export const maintenanceWorker = new Worker<MaintenanceJobData>(
  MAINTENANCE_QUEUE_NAME,
  async (job: Job<MaintenanceJobData>) => {
    const data = job.data;

    if (data.type === "remove-deployments") {
      console.log(`[Maintenance] Removing ${data.deploymentIds.length} deployment(s).`);

      const errors: string[] = [];

      for (const deploymentId of data.deploymentIds) {
        try {
          await removeDeploymentResources(deploymentId);
        } catch (error) {
          errors.push((error as Error).message);
        }
      }

      // Retry the whole job; finished deployments are no-ops the second time.
      if (errors.length > 0) throw new Error(errors.join("\n"));

      return;
    }

    if (data.type === "sync-alias") {
      console.log(`[Maintenance] Syncing subdomain of project ${data.projectId}.`);

      await syncProjectAlias(data.projectId, data.previousSubdomain);
    }
  },
  {
    connection: redis,
    autorun: false,
    // Nginx reloads are serialized inside the worker anyway.
    concurrency: 2,
  },
);

maintenanceWorker.on("failed", (job, error) => {
  console.error(`[Maintenance] Job ${job?.id} failed:`, error.message);
});
