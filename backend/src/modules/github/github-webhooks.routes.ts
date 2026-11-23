
import type { FastifyInstance } from "fastify";

import { AppError } from "../../lib/app-error.js";

import {
  createProjectGitHubWebhook,
  deleteProjectGitHubWebhook,
  processGitHubWebhook,
} from "./github-webhooks.service.js";

export async function githubWebhookRoutes(app: FastifyInstance) {
  app.post(
    "/projects/:projectId/webhook",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "Create a project GitHub webhook",
        security: [{ bearerAuth: [] }],
        params: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const result = await createProjectGitHubWebhook(
        request.user.sub,
        projectId,
      );

      return reply.code(201).send(result);
    },
  );

  app.delete(
    "/projects/:projectId/webhook",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "Delete a project GitHub webhook",
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const { projectId } = request.params as { projectId: string };

      return deleteProjectGitHubWebhook(
        request.user.sub,
        projectId,
      );
    },
  );

  app.post(
    "/webhook/:projectId",
    {
      config: {
        rawBody: true,
      },
      schema: {
        tags: ["GitHub"],
        summary: "Receive GitHub webhook events",
        params: {
          type: "object",
          required: ["projectId"],
          properties: {
            projectId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };

      const rawBody = (
        request as typeof request & { rawBody?: Buffer }
      ).rawBody;

      if (!rawBody || !Buffer.isBuffer(rawBody)) {
        throw new AppError(400, "Raw webhook body is unavailable");
      }

      const signature = request.headers["x-hub-signature-256"];
      const deliveryId = request.headers["x-github-delivery"];
      const event = request.headers["x-github-event"];

const result = await processGitHubWebhook(
  projectId,
  rawBody,
  typeof signature === "string" ? signature : undefined,
  typeof deliveryId === "string" ? deliveryId : undefined,
  typeof event === "string" ? event : undefined,
);
      return reply.code(200).send(result);
    },
  );
}
