
import { z } from "zod";

// ============================================
// ZOD VALIDATION
// ============================================

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");

// Only allow relative paths inside the repository.
const safeRelativePath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !p.startsWith("\\") &&
      !/^[a-zA-Z]:/.test(p) &&
      !p.split(/[\\/]/).includes(".."),
    "Must be a relative path inside the repository"
  );

const projectFields = {
  name: z.string().trim().min(1).max(100),

  repository: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, 'Use the format "owner/repo"')
    .max(200),

  repositoryId: z.string().trim().min(1).max(100).nullable().optional(),

  branch: z.string().trim().min(1).max(255),

  framework: z
    .enum(["vite", "nextjs", "node", "python"])
    .nullable()
    .optional(),

  buildCommand: z.string().trim().min(1).max(500).nullable().optional(),

  startCommand: z.string().trim().min(1).max(500).nullable().optional(),

  outputDir: safeRelativePath.nullable().optional(),

  rootDir: safeRelativePath,
};

// CREATE PROJECT
export const createProjectBodySchema = z.object({
  ...projectFields,
  branch: projectFields.branch.optional(),
  rootDir: projectFields.rootDir.optional(),
});

// UPDATE PROJECT
export const updateProjectBodySchema = z
  .object(projectFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "Provide at least one field to update",
  });

// PROJECT ID PARAMETER
export const projectIdParamsSchema = z.object({ id: objectId });

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

// ============================================
// SWAGGER REQUEST BODY SCHEMAS
// ============================================

const projectRequestProperties = {
  name: {
    type: "string",
    minLength: 1,
    maxLength: 100,
    description: "Project name",
    examples: ["My Portfolio"],
  },
  repository: {
    type: "string",
    maxLength: 200,
    pattern: "^[\\w.-]+/[\\w.-]+$",
    description: "GitHub repository in owner/repo format",
    examples: ["mahek/my-portfolio"],
  },
  repositoryId: {
    type: ["string", "null"],
    description: "GitHub repository ID",
  },
  branch: {
    type: "string",
    minLength: 1,
    maxLength: 255,
    description: "Git branch to deploy",
    examples: ["main"],
  },
  framework: {
    type: ["string", "null"],
    enum: ["vite", "nextjs", "node", "python", null],
    description: "Project framework",
    examples: ["vite"],
  },
  buildCommand: {
    type: ["string", "null"],
    maxLength: 500,
    description: "Build command executed inside the isolated build environment",
    examples: ["npm run build"],
  },
  startCommand: {
    type: ["string", "null"],
    maxLength: 500,
    description: "Start command executed inside the isolated runtime",
    examples: ["npm start"],
  },
  outputDir: {
    type: ["string", "null"],
    maxLength: 200,
    description: "Relative build output directory",
    examples: ["dist"],
  },
  rootDir: {
    type: "string",
    maxLength: 200,
    description: "Relative project root directory inside the repository",
    examples: ["."],
  },
} as const;

export const createProjectBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: projectRequestProperties,
  required: ["name", "repository"],
} as const;

export const updateProjectBodyJsonSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: projectRequestProperties,
} as const;

// ============================================
// RESPONSE SCHEMAS
// ============================================

const nullableString = { type: ["string", "null"] } as const;

const projectJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    repository: { type: "string" },
    repositoryId: nullableString,
    branch: { type: "string" },
    framework: nullableString,
    buildCommand: nullableString,
    startCommand: nullableString,
    outputDir: nullableString,
    rootDir: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: [
    "id",
    "name",
    "repository",
    "branch",
    "rootDir",
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

const singleProject = {
  type: "object",
  properties: { project: projectJsonSchema },
  required: ["project"],
} as const;

export const listProjectsResponseSchema = envelope(200, {
  type: "object",
  properties: {
    projects: {
      type: "array",
      items: projectJsonSchema,
    },
  },
  required: ["projects"],
});

export const createProjectResponseSchema = envelope(
  201,
  singleProject,
  "Project created"
);

export const projectResponseSchema = envelope(200, singleProject);
