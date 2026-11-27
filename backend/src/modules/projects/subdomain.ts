import { z } from "zod";

/**
 * Names that must never be handed out: they are used by the platform itself or are
 * commonly abused for phishing on a shared domain.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "app", "www", "api", "admin", "dashboard", "console", "panel", "root", "system",
  "mail", "smtp", "imap", "pop", "ftp", "ssh", "ns1", "ns2", "dns", "cdn", "static", "assets",
  "status", "docs", "help", "support", "blog", "login", "signin", "signup", "auth", "oauth",
  "billing", "account", "accounts", "secure", "security", "forgedeploy", "shipnest",
  "localhost", "test", "staging", "dev", "prod", "production",
]);

/** Lowercase letters, digits and inner hyphens, 3–40 characters (one DNS label). */
export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters")
  .max(40, "Use at most 40 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Use lowercase letters, numbers and hyphens, and do not start or end with a hyphen",
  )
  .refine((name) => !name.includes("--"), "Do not use two hyphens in a row")
  // 24 hex characters is the deployment URL format; a name like that would shadow a deployment.
  .refine((name) => !/^[a-f0-9]{24}$/.test(name), "This name is not available")
  .refine((name) => !RESERVED_SUBDOMAINS.has(name), "This name is reserved");
