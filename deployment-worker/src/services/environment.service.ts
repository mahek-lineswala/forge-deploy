/**
 * Loads and decrypts project environment variables; shell-exports and log redaction.
 */
import { COLLECTIONS } from "../constants/collections.js";
import { getDatabase } from "../lib/mongodb.js";
import { decryptSecret } from "../lib/encryption.js";
import type { ProjectDocument } from "../types/deployment.types.js";

export interface BuildEnvironmentVariable {
  key: string;
  value: string;
}

interface EnvironmentVariableDocument {
  key: string;
  encryptedValue: string;
}

// Variables the build sandbox itself depends on; a project cannot override them.
const RESERVED_KEYS = new Set([
  "PATH",
  "HOME",
  "PWD",
  "SHELL",
  "USER",
  "HOSTNAME",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_UPDATE_NOTIFIER",
  "COREPACK_HOME",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
]);

export async function loadBuildEnvironment(
  project: ProjectDocument,
): Promise<{ variables: BuildEnvironmentVariable[]; skipped: string[] }> {
  const documents = await getDatabase()
    .collection<EnvironmentVariableDocument>(COLLECTIONS.environmentVariables)
    .find({ projectId: project._id })
    .project<EnvironmentVariableDocument>({ key: 1, encryptedValue: 1 })
    .sort({ key: 1 })
    .toArray();

  const variables: BuildEnvironmentVariable[] = [];
  const skipped: string[] = [];

  for (const document of documents) {
    // Backend already enforces this; re-check because the key becomes shell code.
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(document.key) ||
      RESERVED_KEYS.has(document.key.toUpperCase())
    ) {
      skipped.push(document.key);
      continue;
    }

    variables.push({
      key: document.key,
      value: decryptSecret(
        document.encryptedValue,
        `environment variable ${document.key}`,
      ),
    });
  }

  return { variables, skipped };
}

/** export KEY='value' lines; single quotes keep newlines and $ literal. */
export function toShellExports(variables: BuildEnvironmentVariable[]): string {
  return variables
    .map(({ key, value }) => `export ${key}='${value.replace(/'/g, `'\\''`)}'`)
    .join("\n")
    .concat("\n");
}

/** Replaces secret values in logs. Very short values are left alone to avoid mangling output. */
export function redactSecrets(
  text: string,
  variables: BuildEnvironmentVariable[],
): string {
  let redacted = text;

  for (const { key, value } of variables) {
    if (value.length >= 6) {
      redacted = redacted.split(value).join(`[${key}]`);
    }
  }

  return redacted;
}
