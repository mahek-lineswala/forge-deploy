
import { z } from "zod";

// ============================================
// ZOD VALIDATION
// ============================================

const objectId = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Invalid deployment or project ID");

// Create deployment
export const createDeploymentBodySchema = z.object({
  commitSha: z.string().trim().min(1).max(100).nullable().optional(),

  commitMessage: z.string().trim().min(1).max(500).nullable().optional(),
});

// Deployment ID params
export const deploymentIdParamsSchema = z.object({
  id: objectId,
});

// Project ID params
export const projectIdParamsSchema = z.object({
  projectId: objectId,
});

export type CreateDeploymentBody = z.infer<
  typeof createDeploymentBodySchema
>;

// ============================================
// SWAGGER REQUEST SCHEMAS
// ============================================

export const createDeploymentBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    commitSha: {
      type: ["string", "null"],
      maxLength: 100,
      description: "Git commit SHA associated with this deployment",
      examples: ["a1b2c3d4e5f6"],
    },
    commitMessage: {
      type: ["string", "null"],
      maxLength: 500,
      description: "Git commit message",
      examples: ["Initial deployment"],
    },
  },
} as const;

// ============================================
// RESPONSE SCHEMAS
// ============================================

const deploymentJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    status: {
      type: "string",
      enum: [
        "QUEUED",
        "CLONING",
        "BUILDING",
        "DEPLOYING",
        "HEALTH_CHECK",
        "READY",
        "FAILED",
        "CANCELLED",
        "SUPERSEDED",
      ],
    },
    commitSha: { type: ["string", "null"] },
    commitMessage: { type: ["string", "null"] },
    deploymentUrl: { type: ["string", "null"] },
    projectId: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "status",
    "projectId",
    "createdAt",
    "updatedAt",
  ],
} as const;

function envelope(status: number, data: object, message?: string) {
  return {
    [status]: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        ...(message ? { message: { type: "string" } } : {}),
        data,
      },
      required: ["success", "data"],
    },
  };
}

export const createDeploymentResponseSchema = envelope(
  201,
  {
    type: "object",
    properties: {
      deployment: deploymentJsonSchema,
    },
    required: ["deployment"],
  },
  "Deployment queued successfully"
);

export const deploymentResponseSchema = envelope(200, {
  type: "object",
  properties: {
    deployment: deploymentJsonSchema,
  },
  required: ["deployment"],
});

export const listDeploymentsResponseSchema = envelope(200, {
  type: "object",
  properties: {
    deployments: {
      type: "array",
      items: deploymentJsonSchema,
    },
  },
  required: ["deployments"],
});
