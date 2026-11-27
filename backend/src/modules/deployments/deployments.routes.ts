
import type { FastifyInstance } from "fastify";

import {
  cancelDeployment,
  deleteDeployment,
  createDeployment,
  getDeploymentForUser,
  getDeploymentLogs,
  listDeploymentsForProject,
} from "./deployments.service.js";

import {
  createDeploymentBodySchema,
  createDeploymentBodyJsonSchema,
  createDeploymentResponseSchema,
  deploymentIdParamsSchema,
  deploymentLogsQueryJsonSchema,
  deploymentLogsQuerySchema,
  deploymentLogsResponseSchema,
  deploymentResponseSchema,
  listDeploymentsResponseSchema,
  projectIdParamsSchema,
} from "./deployments.schema.js";

// ============================================
// SWAGGER PARAMETER SCHEMAS
// ============================================

const deploymentIdParamsJsonSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      pattern: "^[a-fA-F0-9]{24}$",
      description: "MongoDB deployment ObjectId",
      examples: ["65a123456789012345678901"],
    },
  },
  required: ["id"],
} as const;

const projectIdParamsJsonSchema = {
  type: "object",
  properties: {
    projectId: {
      type: "string",
      pattern: "^[a-fA-F0-9]{24}$",
      description: "MongoDB project ObjectId",
      examples: ["65a123456789012345678901"],
    },
  },
  required: ["projectId"],
} as const;

const deploymentSecurity = [{ bearerAuth: [] }];

// ============================================
// DEPLOYMENT ROUTES
// ============================================

export async function deploymentsRoutes(app: FastifyInstance) {
  // Every deployment route requires a valid access token.
  app.addHook("onRequest", app.authenticate);

  // ============================================
  // CREATE DEPLOYMENT
  // POST /api/projects/:projectId/deployments
  // ============================================

  app.post(
    "/projects/:projectId/deployments",
    {
      schema: {
        tags: ["Deployments"],
        summary: "Create deployment",
        description:
          "Creates a deployment for a project and adds it to the queue.",
        security: deploymentSecurity,
        params: projectIdParamsJsonSchema,
        body: createDeploymentBodyJsonSchema,
        response: createDeploymentResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId } = projectIdParamsSchema.parse(
        request.params
      );

      const body = createDeploymentBodySchema.parse(
        request.body
      );

      const deployment = await createDeployment(
        request.user.sub,
        projectId,
        body
      );

      return reply.status(201).send({
        success: true,
        message: "Deployment queued successfully",
        data: { deployment },
      });
    }
  );

  // ============================================
  // LIST PROJECT DEPLOYMENTS
  // GET /api/projects/:projectId/deployments
  // ============================================

  app.get(
    "/projects/:projectId/deployments",
    {
      schema: {
        tags: ["Deployments"],
        summary: "List project deployments",
        description:
          "Returns the latest 100 deployments for a project owned by the authenticated user.",
        security: deploymentSecurity,
        params: projectIdParamsJsonSchema,
        response: listDeploymentsResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId } = projectIdParamsSchema.parse(
        request.params
      );

      const deployments = await listDeploymentsForProject(
        request.user.sub,
        projectId
      );

      return reply.send({
        success: true,
        data: { deployments },
      });
    }
  );

  // ============================================
  // GET SINGLE DEPLOYMENT
  // GET /api/deployments/:id
  // ============================================

  app.get(
    "/deployments/:id",
    {
      schema: {
        tags: ["Deployments"],
        summary: "Get deployment",
        description:
          "Returns deployment details if the deployment belongs to the authenticated user.",
        security: deploymentSecurity,
        params: deploymentIdParamsJsonSchema,
        response: deploymentResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = deploymentIdParamsSchema.parse(
        request.params
      );

      const deployment = await getDeploymentForUser(
        request.user.sub,
        id
      );

      return reply.send({
        success: true,
        data: { deployment },
      });
    }
  );

  // ============================================
  // DEPLOYMENT LOGS
  // GET /api/deployments/:id/logs?after=<cursor>&limit=200
  // ============================================

  app.get(
    "/deployments/:id/logs",
    {
      schema: {
        tags: ["Deployments"],
        summary: "Get deployment logs",
        description:
          "Returns build/deploy logs in order. Poll with ?after=<nextCursor> until finished is true.",
        security: deploymentSecurity,
        params: deploymentIdParamsJsonSchema,
        querystring: deploymentLogsQueryJsonSchema,
        response: deploymentLogsResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = deploymentIdParamsSchema.parse(request.params);
      const query = deploymentLogsQuerySchema.parse(request.query);

      const result = await getDeploymentLogs(request.user.sub, id, query);

      return reply.send({
        success: true,
        data: result,
      });
    }
  );

  // ============================================
  // CANCEL DEPLOYMENT
  // POST /api/deployments/:id/cancel
  // ============================================

  app.post(
    "/deployments/:id/cancel",
    {
      schema: {
        tags: ["Deployments"],
        summary: "Cancel deployment",
        description:
          "Cancels a queued or running deployment. A running build is stopped within a few seconds.",
        security: deploymentSecurity,
        params: deploymentIdParamsJsonSchema,
        response: deploymentResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = deploymentIdParamsSchema.parse(
        request.params
      );

      const deployment = await cancelDeployment(
        request.user.sub,
        id
      );

      return reply.send({
        success: true,
        data: { deployment },
      });
    }
  );

  // ============================================
  // DELETE DEPLOYMENT
  // DELETE /api/deployments/:id
  // ============================================

  app.delete(
    "/deployments/:id",
    {
      schema: {
        tags: ["Deployments"],
        summary: "Delete deployment",
        description:
          "Deletes a finished deployment and takes its URL offline. Cancel running deployments first.",
        security: deploymentSecurity,
        params: deploymentIdParamsJsonSchema,
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
              message: { type: "string" },
            },
            required: ["success", "message"],
          },
        },
      },
    },
    async (request, reply) => {
      const { id } = deploymentIdParamsSchema.parse(request.params);

      await deleteDeployment(request.user.sub, id);

      return reply.send({ success: true, message: "Deployment deleted" });
    }
  );
}
