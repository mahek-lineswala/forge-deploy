
import type { FastifyInstance } from "fastify";

import {
  createEnvironmentVariable,
  deleteEnvironmentVariable,
  listEnvironmentVariables,
  updateEnvironmentVariable,
} from "./environment-variables.service.js";

import {
  createEnvironmentVariableBodySchema,
  createEnvironmentVariableBodyJsonSchema,
  createEnvironmentVariableResponseSchema,
  deleteEnvironmentVariableResponseSchema,
  environmentVariableParamsSchema,
  environmentVariableResponseSchema,
  listEnvironmentVariablesResponseSchema,
  environmentVariablesProjectParamsSchema,
  updateEnvironmentVariableBodySchema,
  updateEnvironmentVariableBodyJsonSchema,
} from "./environment-variables.schema.js";

// ============================================
// SWAGGER PARAMS
// ============================================

const projectParamsJsonSchema = {
  type: "object",
  properties: {
    projectId: {
      type: "string",
      pattern: "^[a-fA-F0-9]{24}$",
      description: "MongoDB project ObjectId",
    },
  },
  required: ["projectId"],
} as const;

const environmentVariableParamsJsonSchema = {
  type: "object",
  properties: {
    projectId: {
      type: "string",
      pattern: "^[a-fA-F0-9]{24}$",
      description: "MongoDB project ObjectId",
    },
    key: {
      type: "string",
      pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
      description: "Environment variable name",
      examples: ["DATABASE_URL"],
    },
  },
  required: ["projectId", "key"],
} as const;

const environmentVariableSecurity = [{ bearerAuth: [] }];

// ============================================
// ROUTES
// ============================================

export async function environmentVariableRoutes(
  app: FastifyInstance
) {
  app.addHook("onRequest", app.authenticate);

  // CREATE
  app.post(
    "/projects/:projectId/environment-variables",
    {
      schema: {
        tags: ["Environment Variables"],
        summary: "Create environment variable",
        description:
          "Creates an encrypted environment variable for a project.",
        security: environmentVariableSecurity,
        params: projectParamsJsonSchema,
        body: createEnvironmentVariableBodyJsonSchema,
        response: createEnvironmentVariableResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId } =
        environmentVariablesProjectParamsSchema.parse(
          request.params
        );

      const body = createEnvironmentVariableBodySchema.parse(
        request.body
      );

      const environmentVariable =
        await createEnvironmentVariable(
          request.user.sub,
          projectId,
          body
        );

      return reply.status(201).send({
        success: true,
        message: "Environment variable created",
        data: { environmentVariable },
      });
    }
  );

  // LIST
  app.get(
    "/projects/:projectId/environment-variables",
    {
      schema: {
        tags: ["Environment Variables"],
        summary: "List environment variables",
        description:
          "Lists environment variable names and metadata without exposing their values.",
        security: environmentVariableSecurity,
        params: projectParamsJsonSchema,
        response: listEnvironmentVariablesResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId } =
        environmentVariablesProjectParamsSchema.parse(
          request.params
        );

      const environmentVariables =
        await listEnvironmentVariables(
          request.user.sub,
          projectId
        );

      return reply.send({
        success: true,
        data: { environmentVariables },
      });
    }
  );

  // UPDATE
  app.patch(
    "/projects/:projectId/environment-variables/:key",
    {
      schema: {
        tags: ["Environment Variables"],
        summary: "Update environment variable",
        description:
          "Replaces the encrypted value of an existing environment variable.",
        security: environmentVariableSecurity,
        params: environmentVariableParamsJsonSchema,
        body: updateEnvironmentVariableBodyJsonSchema,
        response: environmentVariableResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId, key } =
        environmentVariableParamsSchema.parse(
          request.params
        );

      const body = updateEnvironmentVariableBodySchema.parse(
        request.body
      );

      const environmentVariable =
        await updateEnvironmentVariable(
          request.user.sub,
          projectId,
          key,
          body
        );

      return reply.send({
        success: true,
        data: { environmentVariable },
      });
    }
  );

  // DELETE
  app.delete(
    "/projects/:projectId/environment-variables/:key",
    {
      schema: {
        tags: ["Environment Variables"],
        summary: "Delete environment variable",
        description:
          "Deletes an environment variable from a project.",
        security: environmentVariableSecurity,
        params: environmentVariableParamsJsonSchema,
        response: deleteEnvironmentVariableResponseSchema,
      },
    },
    async (request, reply) => {
      const { projectId, key } =
        environmentVariableParamsSchema.parse(
          request.params
        );

      await deleteEnvironmentVariable(
        request.user.sub,
        projectId,
        key
      );

      return reply.send({
        success: true,
        message: "Environment variable deleted",
      });
    }
  );
}
