import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  REDIS_URL: z.string().url(),

  DATABASE_URL: z.string().min(1),

  MONGODB_DATABASE: z.string().min(1),

  TEMP_DIR: z.string().default("./temp"),

  LOG_DIR: z.string().default("./logs"),

  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),

  DEPLOYMENTS_DIR: z.string().default("./deployments"),

  DEPLOYMENT_BASE_URL: z.string().url().default("http://localhost:8080"),

  HEALTH_CHECK_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  MAX_CONCURRENT_DEPLOYMENTS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(2),
});

export const env = envSchema.parse(process.env);