
import type { FastifyInstance } from "fastify";

import {
  createProject,
  deleteProject,
  getProjectForUser,
  listProjects,
  updateProject,
} from "./projects.service.js";

import {
  createProjectBodySchema,
  createProjectBodyJsonSchema,
  createProjectResponseSchema,
  listProjectsResponseSchema,
  projectIdParamsSchema,
  projectResponseSchema,
  updateProjectBodySchema,
  updateProjectBodyJsonSchema,
} from "./projects.schema.js";

const projectIdParamsJsonSchema = {
  type: "object",
  properties: {
    id: {
      type: "string",
      pattern: "^[a-fA-F0-9]{24}$",
      description: "MongoDB project ObjectId",
      examples: ["65a123456789012345678901"],
    },
  },
  required: ["id"],
} as const;

const deleteProjectResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
    },
    required: ["success", "message"],
  },
} as const;

const projectSecurity = [{ bearerAuth: [] }];

export async function projectRoutes(app: FastifyInstance) {
  // Every project route requires a valid access token.
  app.addHook("onRequest", app.authenticate);

  // ============================================
  // LIST PROJECTS
  // ============================================

  app.get(
    "/",
    {
      schema: {
        tags: ["Projects"],
        summary: "List projects",
        description: "Returns all projects belonging to the authenticated user.",
        security: projectSecurity,
        response: listProjectsResponseSchema,
      },
    },
    async (request, reply) => {
      const projects = await listProjects(request.user.sub);

      return reply.send({
        success: true,
        data: { projects },
      });
    }
  );

  // ============================================
  // CREATE PROJECT
  // ============================================

  app.post(
    "/",
    {
      schema: {
        tags: ["Projects"],
        summary: "Create project",
        description: "Creates a project linked to a repository.",
        security: projectSecurity,
        body: createProjectBodyJsonSchema,
        response: createProjectResponseSchema,
      },
    },
    async (request, reply) => {
      const body = createProjectBodySchema.parse(request.body);

      const project = await createProject(request.user.sub, body);

      return reply.status(201).send({
        success: true,
        message: "Project created",
        data: { project },
      });
    }
  );

  // ============================================
  // GET PROJECT
  // ============================================

  app.get(
    "/:id",
    {
      schema: {
        tags: ["Projects"],
        summary: "Get project",
        description: "Returns a project owned by the authenticated user.",
        security: projectSecurity,
        params: projectIdParamsJsonSchema,
        response: projectResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);

      const project = await getProjectForUser(request.user.sub, id);

      return reply.send({
        success: true,
        data: { project },
      });
    }
  );

  // ============================================
  // UPDATE PROJECT
  // ============================================

  app.patch(
    "/:id",
    {
      schema: {
        tags: ["Projects"],
        summary: "Update project",
        description: "Updates selected fields of a project owned by the authenticated user.",
        security: projectSecurity,
        params: projectIdParamsJsonSchema,
        body: updateProjectBodyJsonSchema,
        response: projectResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);

      const body = updateProjectBodySchema.parse(request.body);

      const project = await updateProject(request.user.sub, id, body);

      return reply.send({
        success: true,
        data: { project },
      });
    }
  );

  // ============================================
  // DELETE PROJECT
  // ============================================

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["Projects"],
        summary: "Delete project",
        description: "Deletes a project and its deployments.",
        security: projectSecurity,
        params: projectIdParamsJsonSchema,
        response: deleteProjectResponseSchema,
      },
    },
    async (request, reply) => {
      const { id } = projectIdParamsSchema.parse(request.params);

      await deleteProject(request.user.sub, id);

      return reply.send({
        success: true,
        message: "Project deleted",
      });
    }
  );
}
