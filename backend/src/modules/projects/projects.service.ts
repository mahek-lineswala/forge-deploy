import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/app-error.js";
import { deleteProjectGitHubWebhook } from "../github/github-webhooks.service.js";
import { removeQueuedDeployment } from "../deployments/deployments.queue.js";
import { enqueueRemoveDeployments, enqueueSyncAlias } from "../maintenance/maintenance.queue.js";
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
  subdomain: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

/** Flattens the subdomain relation to the plain name the API exposes. */
function toProject<T extends { subdomain: { name: string } | null }>(row: T) {
  return { ...row, subdomain: row.subdomain?.name ?? null };
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const IN_PROGRESS = ["QUEUED", "CLONING", "BUILDING", "DEPLOYING", "HEALTH_CHECK"] as const;

// How long the worker gets to abort running builds before their files are removed.
const ABORT_GRACE_MS = 15_000;

export async function listProjects(userId: string) {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: projectSelect,
  });

  return projects.map(toProject);
}

export async function createProject(userId: string, input: CreateProjectBody) {
  const project = await prisma.project.create({
    data: { ...input, userId },
    select: projectSelect,
  });

  return toProject(project);
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

  return toProject(project);
}

export async function updateProject(
  userId: string,
  id: string,
  input: UpdateProjectBody
) {
  const existing = await getProjectForUser(userId, id);
  const { subdomain, ...fields } = input;

  if (subdomain !== undefined && subdomain !== existing.subdomain) {
    if (subdomain === null) {
      await prisma.projectSubdomain.deleteMany({ where: { projectId: id } });
    } else {
      const taken = await prisma.projectSubdomain.findUnique({ where: { name: subdomain } });

      if (taken && taken.projectId !== id) {
        throw new AppError(409, "This name is already taken");
      }

      try {
        await prisma.projectSubdomain.upsert({
          where: { projectId: id },
          update: { name: subdomain },
          create: { name: subdomain, projectId: id },
        });
      } catch (error) {
        // Two people claiming the same name at the same moment.
        if (isUniqueConstraintError(error)) {
          throw new AppError(409, "This name is already taken");
        }

        throw error;
      }
    }

    // The worker points the name at the latest live deployment (and frees the old name).
    await enqueueSyncAlias(id, existing.subdomain);
  }

  if (Object.keys(fields).length > 0) {
    await prisma.project.update({ where: { id }, data: fields });
  }

  return getProjectForUser(userId, id);
}

/**
 * Deletes the project and everything that belongs to it:
 *  - database: deployments, logs, environment variables, webhook records, subdomain
 *  - GitHub: the push webhook on the repository
 *  - worker (queued): running containers and images, Nginx routes, published files, subdomain route
 */
export async function deleteProject(userId: string, id: string) {
  const project = await getProjectForUser(userId, id);

  const deployments = await prisma.deployment.findMany({
    where: { projectId: id },
    select: { id: true, status: true },
  });

  const deploymentIds = deployments.map((deployment) => deployment.id);
  const inProgress = deployments.filter((deployment) =>
    (IN_PROGRESS as readonly string[]).includes(deployment.status),
  );

  // Stop GitHub from sending pushes to a project that no longer exists.
  // A failure (token revoked, hook already removed by hand) must not block the delete.
  try {
    await deleteProjectGitHubWebhook(userId, id);
  } catch (error) {
    if (!(error instanceof AppError && error.statusCode === 404)) {
      console.error(`Could not remove the GitHub webhook of project ${id}:`, error);
    }
  }

  // Stop anything still building: queued jobs are dropped, running ones see CANCELLED within seconds.
  for (const deployment of inProgress) {
    await removeQueuedDeployment(deployment.id).catch(() => undefined);
  }

  if (inProgress.length > 0) {
    await prisma.deployment.updateMany({
      where: { projectId: id, status: { in: [...IN_PROGRESS] } },
      data: { status: "CANCELLED", errorMessage: "Project deleted", finishedAt: new Date() },
    });
  }

  await prisma.$transaction([
    prisma.deploymentLog.deleteMany({ where: { deploymentId: { in: deploymentIds } } }),
    prisma.deployment.deleteMany({ where: { projectId: id } }),
    prisma.environmentVariable.deleteMany({ where: { projectId: id } }),
    prisma.gitHubWebhook.deleteMany({ where: { projectId: id } }),
    prisma.gitHubWebhookDelivery.deleteMany({ where: { projectId: id } }),
    prisma.projectSubdomain.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);

  await enqueueRemoveDeployments(deploymentIds, inProgress.length > 0 ? ABORT_GRACE_MS : 0);
  await enqueueSyncAlias(id, project.subdomain);
}
