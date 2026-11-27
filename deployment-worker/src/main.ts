/**
 * Process entry point: connects MongoDB and Redis, starts the BullMQ worker and the
 * janitor, and shuts everything down cleanly on SIGINT/SIGTERM.
 */
import {
  connectMongoDB,
  disconnectMongoDB,
} from "./lib/mongodb.js";

import { redis } from "./lib/redis.js";
import { deploymentWorker } from "./worker.js";
import { maintenanceWorker } from "./maintenance.worker.js";
import { runJanitor } from "./services/janitor.service.js";
import { migrateLegacyRuntimeRoutes } from "./services/hosting/runtime-nginx.service.js";

const JANITOR_INTERVAL_MS = 15 * 60 * 1000;

let shuttingDown = false;
let janitorTimer: NodeJS.Timeout | null = null;
let mongoConnected = false;

async function start(): Promise<void> {
  try {
    console.log("[Worker] Starting ForgeDeploy deployment worker...");

    await connectMongoDB();
    mongoConnected = true;

    await redis.ping();

    console.log("[Worker] Redis connection verified.");

    await deploymentWorker.waitUntilReady();

    console.log("[Worker] BullMQ connection ready.");

    // Start consuming jobs only after MongoDB and Redis are ready.
    void deploymentWorker.run().catch((error) => {
      console.error("[Worker] Worker execution failed:", error);
      process.exitCode = 1;
      void shutdown("WORKER_FAILURE");
    });

    await maintenanceWorker.waitUntilReady();

    void maintenanceWorker.run().catch((error) => {
      console.error("[Worker] Maintenance worker failed:", error);
      process.exitCode = 1;
      void shutdown("MAINTENANCE_WORKER_FAILURE");
    });

    console.log("[Worker] ForgeDeploy worker is ready.");

    // Remove leftovers from crashed attempts now, then periodically.
    // Upgrade runtime route files written by older worker versions.
    await migrateLegacyRuntimeRoutes()
      .then((count) => {
        if (count > 0) console.log(`[Worker] Migrated ${count} runtime route(s) to the map format.`);
      })
      .catch((error) => console.error("[Worker] Runtime route migration failed:", error));

    void runJanitor();
    janitorTimer = setInterval(() => void runJanitor(), JANITOR_INTERVAL_MS);
    janitorTimer.unref();
  } catch (error) {
    console.error("[Worker] Startup failed:", error);

    await shutdown("STARTUP_FAILURE", true);

    process.exitCode = 1;
  }
}

async function shutdown(
  signal: string,
  force = false,
): Promise<void> {
  if (shuttingDown) return;

  shuttingDown = true;

  if (janitorTimer) {
    clearInterval(janitorTimer);
  }

  console.log(`[Worker] Received ${signal}. Shutting down...`);

  try {
    await deploymentWorker.close(force);
    await maintenanceWorker.close(force);

    console.log("[Worker] BullMQ worker closed.");

    if (redis.status !== "end") {
      await redis.quit();
    }

    console.log("[Worker] Redis disconnected.");

    if (mongoConnected) {
      await disconnectMongoDB();
      mongoConnected = false;
    }

    console.log("[Worker] MongoDB disconnected.");
    console.log("[Worker] Shutdown completed.");
  } catch (error) {
    console.error("[Worker] Shutdown error:", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void start();
