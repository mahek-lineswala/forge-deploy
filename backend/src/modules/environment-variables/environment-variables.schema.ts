
import { z } from "zod";

// ============================================
// VALIDATION
// ============================================

const envKey = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Invalid environment variable name"
  );

export const createEnvironmentVariableBodySchema = z.object({
  key: envKey,
  value: z.string().max(10000),
});

export const updateEnvironmentVariableBodySchema = z.object({
  value: z.string().max(10000),
});

export const environmentVariableParamsSchema = z.object({
  projectId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid project ID"),
  key: envKey,
});

export const environmentVariablesProjectParamsSchema = z.object({
  projectId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid project ID"),
});

export type CreateEnvironmentVariableBody = z.infer<
  typeof createEnvironmentVariableBodySchema
>;

export type UpdateEnvironmentVariableBody = z.infer<
  typeof updateEnvironmentVariableBodySchema
>;

// ============================================
// SWAGGER REQUEST SCHEMAS
// ============================================

export const createEnvironmentVariableBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    key: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[A-Za-z_][A-Za-z0-9_]*$",
      description: "Environment variable name",
      examples: ["DATABASE_URL"],
    },
    value: {
      type: "string",
      maxLength: 10000,
      description: "Secret value. It is encrypted before storage.",
    },
  },
  required: ["key", "value"],
} as const;

export const updateEnvironmentVariableBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: {
      type: "string",
      maxLength: 10000,
      description: "Replacement value. It is encrypted before storage.",
    },
  },
  required: ["value"],
} as const;

// ============================================
// RESPONSE SCHEMAS
// ============================================

// Deliberately excludes the encrypted and plaintext values.
const environmentVariableJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    key: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "key", "createdAt", "updatedAt"],
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

export const createEnvironmentVariableResponseSchema = envelope(201, {
  type: "object",
  properties: {
    environmentVariable: environmentVariableJsonSchema,
  },
  required: ["environmentVariable"],
});

export const listEnvironmentVariablesResponseSchema = envelope(200, {
  type: "object",
  properties: {
    environmentVariables: {
      type: "array",
      items: environmentVariableJsonSchema,
    },
  },
  required: ["environmentVariables"],
});

export const environmentVariableResponseSchema = envelope(200, {
  type: "object",
  properties: {
    environmentVariable: environmentVariableJsonSchema,
  },
  required: ["environmentVariable"],
});

export const deleteEnvironmentVariableResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
    },
    required: ["success", "message"],
  },
} as const;
