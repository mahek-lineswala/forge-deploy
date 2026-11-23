
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { AppError } from "./app-error.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const value = process.env.ENCRYPTION_KEY;

  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new AppError(
      500,
      "Encryption is not configured correctly"
    );
  }

  return Buffer.from(value, "hex");
}

// ============================================
// ENCRYPT
// ============================================

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: version:iv:authTag:ciphertext
  return [
    "v1",
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

// ============================================
// DECRYPT
// ============================================

export function decrypt(encryptedValue: string): string {
  const key = getEncryptionKey();

  const parts = encryptedValue.split(":");

  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new AppError(500, "Invalid encrypted data format");
  }

  const [, ivHex, authTagHex, ciphertextHex] = parts;

  if (
    !/^[a-fA-F0-9]{24}$/.test(ivHex) ||
    !/^[a-fA-F0-9]{32}$/.test(authTagHex) ||
    !/^(?:[a-fA-F0-9]{2})*$/.test(ciphertextHex)
  ) {
    throw new AppError(500, "Invalid encrypted data");
  }

  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv);

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch {
    throw new AppError(
      500,
      "Unable to decrypt stored data"
    );
  }
}
