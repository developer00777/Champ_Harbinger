import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.HARBINGER_SECRET;
  if (!secret)
    throw new Error("HARBINGER_SECRET env var is required for key encryption");
  // Pad or hash to exactly 32 bytes
  return Buffer.from(secret.padEnd(32, "0").slice(0, 32), "utf8");
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(12);
  const key = getKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptApiKey(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !encryptedHex)
    throw new Error("Invalid encrypted key format");
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export function maskApiKey(value: string): {
  keyPrefix: string;
  keySuffix: string;
} {
  return {
    keyPrefix: value.slice(0, 12),
    keySuffix: value.slice(-4),
  };
}
