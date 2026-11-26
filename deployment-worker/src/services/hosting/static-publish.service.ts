/**
 * Atomic publish of static build output into DEPLOYMENTS_DIR.
 */
import fs from "node:fs/promises";
import path from "node:path";

const RETRYABLE_FS_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);

/**
 * Windows (and Docker Desktop bind mounts) can briefly lock a directory
 * that Nginx or an antivirus scanner is reading, so renames get a few retries.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";

      if (attempt >= 5 || !RETRYABLE_FS_CODES.has(code)) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/**
 * Publishes `source` to `destination` so the live directory is never half-written:
 *   1. copy into   <root>/.staging/<id>-<workerId>   (slow, invisible to Nginx)
 *   2. move live → <root>/.trash/<id>-<workerId>    (instant)
 *   3. move staging → live                           (instant)
 *   4. delete trash
 * If step 3 fails the previous version is moved back.
 * Nginx only serves 24-hex directory names, so .staging/.trash are never public.
 */
export async function publishDirectoryAtomically(
  source: string,
  destination: string,
  workerId: string,
  assertLease: () => Promise<void>,
): Promise<void> {
  const root = path.dirname(destination);
  const name = `${path.basename(destination)}-${workerId}`;
  const staging = path.join(root, ".staging", name);
  const trash = path.join(root, ".trash", name);

  await fs.mkdir(path.dirname(staging), { recursive: true });
  await fs.mkdir(path.dirname(trash), { recursive: true });
  await fs.rm(staging, { recursive: true, force: true });

  try {
    await fs.cp(source, staging, {
      recursive: true,
      errorOnExist: true,
      force: false,
      dereference: false,
    });

    // Last ownership check before touching the live directory.
    await assertLease();

    let hadPrevious = true;

    try {
      await renameWithRetry(destination, trash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      hadPrevious = false;
    }

    try {
      await renameWithRetry(staging, destination);
    } catch (error) {
      if (hadPrevious) {
        await renameWithRetry(trash, destination).catch(() => undefined);
      }

      throw error;
    }

    if (hadPrevious) {
      await fs
        .rm(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
        .catch(() => undefined); // janitor removes it later if locked
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
