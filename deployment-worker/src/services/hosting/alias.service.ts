/**
 * Custom project subdomains: <name>.<domain> always serves the project's latest READY
 * deployment. The name -> project mapping lives in MongoDB (ProjectSubdomain, written by
 * the API); this module turns it into Nginx alias files (see runtime-nginx.service.ts).
 */
import { ObjectId } from "mongodb";

import { COLLECTIONS } from "../../constants/collections.js";
import { getDatabase } from "../../lib/mongodb.js";
import {
  listSubdomainAliases,
  removeSubdomainAlias,
  setSubdomainAlias,
} from "./runtime-nginx.service.js";

import type { DeploymentDocument } from "../../types/deployment.types.js";

interface ProjectSubdomainDocument {
  _id: ObjectId;
  name: string;
  projectId: ObjectId;
}

function subdomains() {
  return getDatabase().collection<ProjectSubdomainDocument>(COLLECTIONS.projectSubdomains);
}

/**
 * Points the project's subdomain at its newest READY deployment, or takes the name
 * offline when there is none. `previousSubdomain` is a name the project just gave up.
 */
export async function syncProjectAlias(projectId: string, previousSubdomain?: string | null): Promise<void> {
  if (!ObjectId.isValid(projectId)) return;

  const projectObjectId = new ObjectId(projectId);
  const current = await subdomains().findOne({ projectId: projectObjectId });

  if (previousSubdomain && previousSubdomain !== current?.name) {
    // The freed name may already belong to another project; only an unclaimed name goes offline.
    const claimed = await subdomains().findOne({ name: previousSubdomain });

    if (!claimed) {
      await removeSubdomainAlias(previousSubdomain);
    }
  }

  if (!current) return;

  const live = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .find({ projectId: projectObjectId, status: "READY" }, { projection: { _id: 1 } })
    .sort({ createdAt: -1 })
    .limit(1)
    .next();

  if (live) {
    await setSubdomainAlias(current.name, live._id.toHexString());
  } else {
    await removeSubdomainAlias(current.name);
  }
}

/** Called after a deployment went live: moves its project's subdomain (if any) to it. */
export async function syncAliasForDeployment(deploymentId: string): Promise<void> {
  if (!ObjectId.isValid(deploymentId)) return;

  const deployment = await getDatabase()
    .collection<DeploymentDocument>(COLLECTIONS.deployments)
    .findOne({ _id: new ObjectId(deploymentId) }, { projection: { projectId: 1 } });

  if (deployment) {
    await syncProjectAlias(deployment.projectId.toHexString());
  }
}

/** Repairs every alias from MongoDB: fixes stale targets and removes names nobody owns anymore. */
export async function reconcileSubdomainAliases(): Promise<number> {
  const rows = await subdomains().find({}).toArray();
  const owned = new Set(rows.map((row) => row.name));
  let changed = 0;

  for (const row of rows) {
    try {
      await syncProjectAlias(row.projectId.toHexString());
    } catch (error) {
      console.error(`[Alias] Could not sync ${row.name}:`, (error as Error).message);
    }
  }

  for (const name of await listSubdomainAliases()) {
    if (owned.has(name)) continue;

    try {
      await removeSubdomainAlias(name);
      changed += 1;
    } catch (error) {
      console.error(`[Alias] Could not remove ${name}:`, (error as Error).message);
    }
  }

  return changed;
}
