import { createCipheriv, createDecipheriv, randomUUID, randomBytes } from "node:crypto";

const IV_BYTE_LENGTH = 12;

function parseEncryptionKey(base64Key) {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("Encryption key must be 32 bytes after base64 decoding.");
  }
  return key;
}

export function createSessionId() {
  return randomUUID();
}

export function encryptSecret(plainText, base64Key) {
  const key = parseEncryptionKey(base64Key);
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload, base64Key) {
  const [ivB64, authTagB64, cipherB64] = payload.split(".");
  if (!ivB64 || !authTagB64 || !cipherB64) {
    throw new Error("Invalid encrypted payload.");
  }

  const key = parseEncryptionKey(base64Key);
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(cipherB64, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
