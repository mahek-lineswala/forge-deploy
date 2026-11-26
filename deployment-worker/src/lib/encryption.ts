/**
 * AES-256-GCM decryption compatible with the backend's encrypt().
 */
import { createDecipheriv } from "node:crypto";

import { env } from "../config/env.js";
import { NonRetryableError } from "../utils/errors.js";

/**
 * Decrypts values written by the backend's encrypt():
 *   v1:<iv hex>:<auth tag hex>:<ciphertext hex>   (AES-256-GCM)
 */
export function decryptSecret(encryptedValue: string, label = "secret"): string {
  const parts = encryptedValue.split(":");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new NonRetryableError(`Invalid encrypted ${label} format.`);
  }

  const [, ivHex, authTagHex, ciphertextHex] = parts;

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(env.ENCRYPTION_KEY, "hex"),
      Buffer.from(ivHex!, "hex"),
    );

    decipher.setAuthTag(Buffer.from(authTagHex!, "hex"));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex!, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong ENCRYPTION_KEY or corrupted value: retrying cannot help.
    throw new NonRetryableError(
      `Could not decrypt the ${label}. Check that backend and worker use the same ENCRYPTION_KEY.`,
    );
  }
}
