import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key) {
    throw new Error("ENCRYPTION_MASTER_KEY environment variable is not set");
  }
  return Buffer.from(key, "base64");
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return scryptSync(masterKey, salt, 32);
}

/**
 * Encrypts a string using AES-256-GCM with a derived key
 * Format: base64(salt + iv + authTag + ciphertext)
 */
export function encrypt(plaintext: string): string {
  const masterKey = getMasterKey();
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(masterKey, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  return combined.toString("base64");
}

/**
 * Decrypts an encrypted string
 */
export function decrypt(encryptedData: string): string {
  const masterKey = getMasterKey();
  const combined = Buffer.from(encryptedData, "base64");

  // Extract components
  const salt = combined.subarray(0, SALT_LENGTH);
  const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = combined.subarray(
    SALT_LENGTH + IV_LENGTH,
    SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
  );
  const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(masterKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Encrypts sensitive data, returns null if input is null/undefined
 */
export function encryptIfPresent(value: string | null | undefined): string | null {
  if (!value) return null;
  return encrypt(value);
}

/**
 * Decrypts sensitive data, returns null if input is null/undefined
 */
export function decryptIfPresent(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    console.error("Failed to decrypt value");
    return null;
  }
}

/**
 * Hashes content for deduplication (not for security)
 */
export function hashContent(content: string): string {
  const { createHash } = require("crypto");
  return createHash("sha256").update(content).digest("hex");
}
