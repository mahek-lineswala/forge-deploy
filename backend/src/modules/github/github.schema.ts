
import { z } from "zod";

// ============================================
// OAUTH CALLBACK
// ============================================

export const githubCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
});

// ============================================
// REPOSITORY QUERY
// ============================================

export const githubRepositoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(30),
});

export type GitHubRepositoriesQuery = z.infer<
  typeof githubRepositoriesQuerySchema
>;

// ============================================
// SWAGGER RESPONSE SCHEMAS
// ============================================

export const githubConnectResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      data: {
        type: "object",
        properties: {
          authorizationUrl: {
            type: "string",
            format: "uri",
          },
        },
        required: ["authorizationUrl"],
      },
    },
    required: ["success", "data"],
  },
} as const;

export const githubAccountResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      data: {
        type: "object",
        properties: {
          account: {
            type: "object",
            properties: {
              githubUserId: { type: "string" },
              githubUsername: { type: "string" },
              avatarUrl: { type: ["string", "null"] },
              scopes: {
                type: "array",
                items: { type: "string" },
              },
              connectedAt: {
                type: "string",
                format: "date-time",
              },
            },
            required: [
              "githubUserId",
              "githubUsername",
              "scopes",
              "connectedAt",
            ],
          },
        },
        required: ["account"],
      },
    },
    required: ["success", "data"],
  },
} as const;

export const githubRepositoriesResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      data: {
        type: "object",
        properties: {
          repositories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                fullName: { type: "string" },
                private: { type: "boolean" },
                htmlUrl: { type: "string" },
                description: { type: ["string", "null"] },
                defaultBranch: { type: "string" },
                language: { type: ["string", "null"] },
                updatedAt: { type: "string", format: "date-time" },
                owner: { type: "string" },
                ownerAvatarUrl: { type: "string" },
              },
              required: [
                "id",
                "name",
                "fullName",
                "private",
                "htmlUrl",
                "defaultBranch",
                "updatedAt",
                "owner",
                "ownerAvatarUrl",
              ],
            },
          },
          pagination: {
            type: "object",
            properties: {
              page: { type: "integer" },
              perPage: { type: "integer" },
            },
            required: ["page", "perPage"],
          },
        },
        required: ["repositories", "pagination"],
      },
    },
    required: ["success", "data"],
  },
} as const;

export const githubDisconnectResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
    },
    required: ["success", "message"],
  },
} as const;
