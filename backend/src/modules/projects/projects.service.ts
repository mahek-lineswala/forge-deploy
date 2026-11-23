import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import type { CreateProjectBody, UpdateProjectBody } from "./projects.schema.js";

const projectSelect = {
  id: true,
  name: true,
  repository: true,
  repositoryId: true,
  branch: true,
  framework: true,
  buildCommand: true,
  startCommand: true,
  outputDir: true,
  rootDir: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listProjects(userId: string) {
  return prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: projectSelect,
  });
}

export async function createProject(userId: string, input: CreateProjectBody) {
  return prisma.project.create({
    data: { ...input, userId },
    select: projectSelect,
  });
}

// Ownership check lives here: every lookup is scoped to the owner, and a
// project that belongs to someone else looks exactly like one that doesn't exist.
export async function getProjectForUser(userId: string, id: string) {
  const project = await prisma.project.findFirst({
    where: { id, userId },
    select: projectSelect,
  });

  if (!project) {
    throw new AppError(404, "Project not found");
  }

  return project;
}

export async function updateProject(
  userId: string,
  id: string,
  input: UpdateProjectBody
) {
  await getProjectForUser(userId, id);

  return prisma.project.update({
    where: { id },
    data: input,
    select: projectSelect,
  });
}

export async function deleteProject(userId: string, id: string) {
  await getProjectForUser(userId, id);

  // Deployments reference the project, so remove them first.
  // Extend this when logs / env vars exist.
  await prisma.$transaction([
    prisma.deployment.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);
}