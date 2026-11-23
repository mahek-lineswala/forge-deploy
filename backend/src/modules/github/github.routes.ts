
import type { FastifyInstance } from "fastify";

import {
  createGitHubAuthorizationUrl,
  completeGitHubOAuth,
  disconnectGitHub,
  getGitHubAccount,
  getGitHubCallbackRedirect,
  listGitHubRepositories,
} from "./github.service.js";

import {
  githubAccountResponseSchema,
  githubCallbackQuerySchema,
  githubConnectResponseSchema,
  githubDisconnectResponseSchema,
  githubRepositoriesQuerySchema,
  githubRepositoriesResponseSchema,
} from "./github.schema.js";

const githubSecurity = [{ bearerAuth: [] }];

export async function githubRoutes(app: FastifyInstance) {
  // ============================================
  // CONNECT
  // GET /api/github/connect
  // ============================================

  app.get(
    "/connect",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "Connect GitHub",
        description:
          "Generates a GitHub OAuth authorization URL for the authenticated user.",
        security: githubSecurity,
        response: githubConnectResponseSchema,
      },
    },
    async (request, reply) => {
      const authorizationUrl =
        await createGitHubAuthorizationUrl(request.user.sub);

      return reply.send({
        success: true,
        data: { authorizationUrl },
      });
    }
  );

  // ============================================
  // OAUTH CALLBACK
  // GET /api/github/callback
  // ============================================

  app.get(
    "/callback",
    {
      schema: {
        tags: ["GitHub"],
        summary: "GitHub OAuth callback",
        description:
          "Handles GitHub's OAuth redirect and saves the authenticated GitHub account.",
      },
    },
    async (request, reply) => {
      const query = githubCallbackQuerySchema.safeParse(
        request.query
      );

      if (!query.success) {
        return reply.redirect(
          getGitHubCallbackRedirect("error")
        );
      }

      const { code, state, error } = query.data;

      if (error || !code || !state) {
        return reply.redirect(
          getGitHubCallbackRedirect("error")
        );
      }

      try {
        await completeGitHubOAuth(code, state);

        return reply.redirect(
          getGitHubCallbackRedirect("success")
        );
      } catch (err) {
        request.log.error(
          { err },
          "GitHub OAuth callback failed"
        );

        return reply.redirect(
          getGitHubCallbackRedirect("error")
        );
      }
    }
  );

  // ============================================
  // CONNECTED ACCOUNT
  // GET /api/github/account
  // ============================================

  app.get(
    "/account",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "Get connected GitHub account",
        description:
          "Returns the connected GitHub account without exposing its access token.",
        security: githubSecurity,
        response: githubAccountResponseSchema,
      },
    },
    async (request, reply) => {
      const account = await getGitHubAccount(
        request.user.sub
      );

      return reply.send({
        success: true,
        data: { account },
      });
    }
  );

  // ============================================
  // LIST REPOSITORIES
  // GET /api/github/repositories
  // ============================================

  app.get(
    "/repositories",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "List GitHub repositories",
        description:
          "Lists repositories accessible to the connected GitHub account.",
        security: githubSecurity,
        querystring: {
          type: "object",
          properties: {
            page: {
              type: "integer",
              minimum: 1,
              default: 1,
            },
            perPage: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 30,
            },
          },
        },
        response: githubRepositoriesResponseSchema,
      },
    },
    async (request, reply) => {
      const query = githubRepositoriesQuerySchema.parse(
        request.query
      );

      const result = await listGitHubRepositories(
        request.user.sub,
        query
      );

      return reply.send({
        success: true,
        data: result,
      });
    }
  );

  // ============================================
  // DISCONNECT
  // DELETE /api/github/connection
  // ============================================

  app.delete(
    "/connection",
    {
      preHandler: app.authenticate,
      schema: {
        tags: ["GitHub"],
        summary: "Disconnect GitHub",
        description:
          "Removes the GitHub connection and encrypted access token from ForgeDeploy.",
        security: githubSecurity,
        response: githubDisconnectResponseSchema,
      },
    },
    async (request, reply) => {
      await disconnectGitHub(request.user.sub);

      return reply.send({
        success: true,
        message: "GitHub account disconnected",
      });
    }
  );
}
