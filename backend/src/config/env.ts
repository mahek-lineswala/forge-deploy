
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  PORT: z.coerce.number().default(5000),

  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1),

  REDIS_URL: z
    .string()
    .url()
    .default("redis://127.0.0.1:6379"),

  JWT_SECRET: z.string().min(32),

  FRONTEND_URL: z
    .string()
    .url()
    .default("http://localhost:5173"),
});

export const env = envSchema.parse(process.env);
