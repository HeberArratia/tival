import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

/**
 * Cifrado at-rest de secrets por conexión.
 * La llave es de plataforma (env); los valores son por workspace.
 */
function encryptionKey(): Buffer {
  const raw =
    process.env.INTEGRATIONS_ENCRYPTION_KEY ||
    process.env.TIVAL_INTERNAL_KEY ||
    "dev-only-insecure-integrations-key";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivB64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]);
    return dec.toString("utf8");
  } catch {
    // Llave distinta (local vs Vercel) o payload corrupto.
    return null;
  }
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
