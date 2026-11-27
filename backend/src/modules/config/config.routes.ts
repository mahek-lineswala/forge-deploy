import type { FastifyInstance } from "fastify";

import { env } from "../../config/env.js";

/** Public, non-secret settings the dashboard needs to render URLs. */
export async function configRoutes(app: FastifyInstance) {
  app.get(
    "/config",
    {
      schema: {
        tags: ["Config"],
        summary: "Public platform settings",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              data: {
                type: "object",
                properties: {
                  deploymentDomain: { type: ["string", "null"] },
                  autoDeployAvailable: { type: "boolean" },
                },
                required: ["deploymentDomain", "autoDeployAvailable"],
              },
            },
            required: ["success", "data"],
          },
        },
      },
    },
    async () => ({
      success: true,
      data: {
        // Host that deployments and custom subdomains live under, e.g. shipnest.dpdns.org.
        deploymentDomain: env.DEPLOYMENT_DOMAIN ?? null,
        // GitHub can only call back when the platform has a public webhook URL.
        autoDeployAvailable: Boolean(process.env.GITHUB_WEBHOOK_URL),
      },
    }),
  );
}
