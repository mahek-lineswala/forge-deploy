
  import { z } from "zod";

  // ============================================
  // ZOD VALIDATION SCHEMAS
  // ============================================

  const emailField = z.string().trim().toLowerCase().email().max(254);

  export const registerBodySchema = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    email: emailField,
    password: z.string().min(8).max(128),
  });

  export const loginBodySchema = z.object({
    email: emailField,
    password: z.string().min(1).max(128),
  });

  export type RegisterBody = z.infer<typeof registerBodySchema>;
  export type LoginBody = z.infer<typeof loginBodySchema>;

  // ============================================
  // SWAGGER REQUEST BODY SCHEMAS
  // ============================================

  export const registerBodyJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 100,
        description: "User's display name",
        examples: ["Mahek"],
      },
      email: {
        type: "string",
        format: "email",
        maxLength: 254,
        description: "Account email address",
        examples: ["mahek@example.com"]
      },
      password: {
        type: "string",
        minLength: 8,
        maxLength: 128,
        description: "Account password",
          examples: ["StrongPassword123!"],
      },
    },
    required: ["email", "password"],
  } as const;

  export const loginBodyJsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      email: {
        type: "string",
        format: "email",
        maxLength: 254,
        examples: ["mahek@example.com"],
      },
      password: {
        type: "string",
        minLength: 1,
        maxLength: 128,
        examples: ["StrongPassword123!"],
      },
    },
    required: ["email", "password"],
  } as const;

  // ============================================
  // RESPONSE SCHEMAS
  // ============================================

  const userJsonSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: ["string", "null"] },
      email: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
    required: ["id", "email", "createdAt"],
  } as const;

  export const errorResponseSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", example: false },
      message: { type: "string" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            message: { type: "string" },
          },
          required: ["path", "message"],
        },
      },
    },
    required: ["success", "message"],
  } as const;

  export const registerResponseSchema = {
    201: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        data: {
          type: "object",
          properties: { user: userJsonSchema },
          required: ["user"],
        },
      },
      required: ["success", "message", "data"],
    },
    400: errorResponseSchema,
    409: errorResponseSchema,
  } as const;

  export const sessionResponseSchema = {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        data: {
          type: "object",
          properties: {
            user: userJsonSchema,
            accessToken: { type: "string" },
          },
          required: ["user", "accessToken"],
        },
      },
      required: ["success", "message", "data"],
    },
    400: errorResponseSchema,
    401: errorResponseSchema,
  } as const;

  export const meResponseSchema = {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        data: {
          type: "object",
          properties: { user: userJsonSchema },
          required: ["user"],
        },
      },
      required: ["success", "data"],
    },
    401: errorResponseSchema,
  } as const;
