
import {
  connectMongoDB,
  disconnectMongoDB,
} from "./lib/mongodb.js";

import { redis } from "./lib/redis.js";
import { deploymentWorker } from "./worker.js";

let shuttingDown = false;
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

    console.log("[Worker] ForgeDeploy worker is ready.");
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

  console.log(`[Worker] Received ${signal}. Shutting down...`);

  try {
    await deploymentWorker.close(force);

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
