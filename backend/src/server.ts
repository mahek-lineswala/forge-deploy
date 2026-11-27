
import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { redis } from "./lib/redis.js";
import { deploymentQueue } from "./modules/deployments/deployments.queue.js";
import { maintenanceQueue } from "./modules/maintenance/maintenance.queue.js";
import { startDeploymentReconciler } from "./modules/deployments/deployments.reconciler.js";

async function start() {
  const app = await buildApp();

  let shuttingDown = false;

  try {
    // ============================================
    // CONNECT TO MONGODB
    // ============================================

    await prisma.$connect();

    app.log.info("MongoDB connected successfully");

    // ============================================
    // CONNECT TO REDIS
    // ============================================

    await redis.ping();

    app.log.info("Redis connected successfully");

    // ============================================
    // INITIALIZE BULLMQ QUEUE
    // ============================================

    await deploymentQueue.waitUntilReady();
    await maintenanceQueue.waitUntilReady();

    app.log.info("Deployment queue initialized successfully");

    // ============================================
    // START SERVER
    // ============================================

    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });

    app.log.info(`ForgeDeploy running on port ${env.PORT}`);

    const stopReconciler = startDeploymentReconciler(app.log);

    // ============================================
    // GRACEFUL SHUTDOWN
    // ============================================

    const shutdown = async (signal: string) => {
      if (shuttingDown) return;

      shuttingDown = true;

      stopReconciler();

      app.log.info(`Received ${signal}. Shutting down ForgeDeploy...`);

      try {
        await app.close();

        await prisma.$disconnect();

        app.log.info("ForgeDeploy shutdown completed.");
      } catch (error) {
        app.log.error(error, "Error during shutdown");
        process.exitCode = 1;
      }
    };

    process.once("SIGINT", () => void shutdown("SIGINT"));
    process.once("SIGTERM", () => void shutdown("SIGTERM"));

  } catch (error) {
    app.log.error(error, "Failed to start ForgeDeploy");

    try {
      await app.close();
    } catch {
      // Continue cleanup.
    }

    try {
      await prisma.$disconnect();
    } catch {
      // Continue cleanup.
    }

    if (redis.status !== "end") {
      redis.disconnect();
    }

    process.exitCode = 1;
  }
}

void start();
