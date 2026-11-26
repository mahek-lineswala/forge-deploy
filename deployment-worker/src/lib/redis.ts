/**
 * Redis connection used by BullMQ.
 */
import { Redis } from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on("connect", () => {
  console.log("Worker Redis connected.");
});

redis.on("error", (error: Error) => {
  console.error("Worker Redis connection error:", error.message);
});