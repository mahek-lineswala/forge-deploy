
import type { FastifyInstance } from "fastify";

import {
  cancelDeployment,
  createDeployment,
  getDeploymentForUser,
  listDeploymentsForProject,
} from "./deployments.service.js";

import {
  createDeploymentBodySchema,
  createDeploymentBodyJsonSchema,
  createDeploymentResponseSchema,
  deploymentIdParamsSchema,
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
          "Cancels a deployment that is still waiting in the queue.",
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
}
