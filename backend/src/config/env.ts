
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

  // true when running behind a reverse proxy (Nginx in production), so request.ip,
  // rate limiting and logs use the client IP from X-Forwarded-For instead of the proxy's.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Host that deployments are served under (e.g. shipnest.dpdns.org). Lets the
  // dashboard show custom subdomains; leave unset in local development.
  DEPLOYMENT_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9.-]+$/, "DEPLOYMENT_DOMAIN must be a host name, without https://")
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Interactive Swagger UI at /documentation. Disable on public deployments.
  API_DOCS_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export const env = envSchema.parse(process.env);
