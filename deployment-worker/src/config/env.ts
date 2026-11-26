/**
 * Validated worker configuration from .env (see .env.example).
 */
import "dotenv/config";
import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const envSchema = z.object({
  // ── Runtime ───────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  MAX_CONCURRENT_DEPLOYMENTS: z.coerce.number().int().min(1).max(20).default(2),

  // ── Shared with the backend ───────────────────────────────
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  MONGODB_DATABASE: z.string().min(1),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),

  // ── Local folders ─────────────────────────────────────────
  TEMP_DIR: z.string().default("./temp"),
  LOG_DIR: z.string().default("./logs"),
  DEPLOYMENTS_DIR: z.string().default("./deployments"),

  // ── Build sandbox ─────────────────────────────────────────
  // Builds run as this uid:gid (the "node" user in node:22-alpine). Use "root" only if
  // your Docker setup cannot write to the build volumes as a normal user.
  BUILD_USER: z.string().regex(/^(root|\d+:\d+)$/).default("1000:1000"),

  // Resources for install/build containers. Next.js builds benefit from more CPU.
  BUILD_CPUS: z.string().regex(/^\d+(\.\d+)?$/).default("2"),
  BUILD_MEMORY: z.string().regex(/^\d+[mg]$/).default("4g"),

  // true: dependencies install with network, the build step runs with --network none.
  BUILD_NETWORK_ISOLATION: booleanFlag,

  // Shared npm/pnpm/yarn/corepack download cache (Docker volume) reused by every build.
  BUILD_CACHE_VOLUME: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/)
    .default("forgedeploy-build-cache"),

  // ── Hosting ───────────────────────────────────────────────
  // Deployments are served at http://<deploymentId>.<host>:<port>.
  DEPLOYMENT_BASE_URL: z.string().url().default("http://localhost:8080"),
  HEALTH_CHECK_ENABLED: booleanFlag,
  NGINX_CONTAINER_NAME: z.string().default("forgedeploy-nginx"),

  // One <deploymentId>.conf per runtime deployment; mounted into Nginx at /etc/nginx/runtime.
  RUNTIME_NGINX_DIR: z.string().default("./runtime-nginx"),

  // ── Runtime containers ────────────────────────────────────
  RUNTIME_DOCKER_NETWORK: z.string().default("forgedeploy-network"),
  RUNTIME_CONTAINER_MEMORY: z.string().default("512m"),
  RUNTIME_CONTAINER_CPUS: z.string().default("1"),
});

export const env = envSchema.parse(process.env);
