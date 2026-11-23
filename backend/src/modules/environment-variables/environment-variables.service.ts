import { encrypt } from "../../lib/encryption.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";

import type {
  CreateEnvironmentVariableBody,
  UpdateEnvironmentVariableBody,
} from "./environment-variables.schema.js";


// ============================================
// PROJECT OWNERSHIP
// ============================================

async function ensureProjectOwnership(
  userId: string,
  projectId: string
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId,
    },
    select: {
      id: true,
    },
  });

  if (!project) {
    throw new AppError(404, "Project not found");
  }

  return project;
}

// ============================================
// SAFE RESPONSE
// ============================================

// Never return encryptedValue or plaintext value.
function toSafeEnvironmentVariable(variable: {
  id: string;
  key: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: variable.id,
    key: variable.key,
    createdAt: variable.createdAt,
    updatedAt: variable.updatedAt,
  };
}

// ============================================
// CREATE ENVIRONMENT VARIABLE
// ============================================

export async function createEnvironmentVariable(
  userId: string,
  projectId: string,
  body: CreateEnvironmentVariableBody
) {
  await ensureProjectOwnership(userId, projectId);

  try {
    const variable = await prisma.environmentVariable.create({
      data: {
        key: body.key,
        encryptedValue: encrypt(body.value),
        projectId,
      },
      select: {
        id: true,
        key: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return toSafeEnvironmentVariable(variable);
  } catch (error) {
    const prismaError = error as { code?: string };

    if (prismaError.code === "P2002") {
      throw new AppError(
        409,
        "An environment variable with this key already exists"
      );
    }

    throw error;
  }
}

// ============================================
// LIST ENVIRONMENT VARIABLES
// ============================================

export async function listEnvironmentVariables(
  userId: string,
  projectId: string
) {
  await ensureProjectOwnership(userId, projectId);

  const variables = await prisma.environmentVariable.findMany({
    where: {
      projectId,
    },
    select: {
      id: true,
      key: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: {
      key: "asc",
    },
  });

  return variables.map(toSafeEnvironmentVariable);
}

// ============================================
// UPDATE ENVIRONMENT VARIABLE
// ============================================

export async function updateEnvironmentVariable(
  userId: string,
  projectId: string,
  key: string,
  body: UpdateEnvironmentVariableBody
) {
  await ensureProjectOwnership(userId, projectId);

  const existing = await prisma.environmentVariable.findFirst({
    where: {
      projectId,
      key,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new AppError(404, "Environment variable not found");
  }

  const variable = await prisma.environmentVariable.update({
    where: {
      id: existing.id,
    },
    data: {
      encryptedValue: encrypt(body.value),
    },
    select: {
      id: true,
      key: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return toSafeEnvironmentVariable(variable);
}

// ============================================
// DELETE ENVIRONMENT VARIABLE
// ============================================

export async function deleteEnvironmentVariable(
  userId: string,
  projectId: string,
  key: string
) {
  await ensureProjectOwnership(userId, projectId);

  const existing = await prisma.environmentVariable.findFirst({
    where: {
      projectId,
      key,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    throw new AppError(404, "Environment variable not found");
  }

  await prisma.environmentVariable.delete({
    where: {
      id: existing.id,
    },
  });
}
