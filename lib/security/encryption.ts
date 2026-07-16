import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/config/env";
import { ApiError } from "@/lib/api/errors";

function encryptionKey() {
  if (!env.APP_ENCRYPTION_KEY) throw new ApiError("Secret encryption is not configured.", 503, "NOT_CONFIGURED");
  return createHash("sha256").update(env.APP_ENCRYPTION_KEY, "utf8").digest();
}

export function encryptSecret(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new ApiError("Stored integration secret is invalid.", 500, "OPERATION_FAILED");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new ApiError("Stored integration secret could not be decrypted.", 500, "OPERATION_FAILED");
  }
}
