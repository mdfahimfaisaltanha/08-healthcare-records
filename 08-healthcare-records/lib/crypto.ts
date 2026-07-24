import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Field-level encryption: AES-256-GCM, one random 12-byte IV per value.
 *
 * Ciphertext format (versioned for future key rotation):
 *
 *   enc:v1:<iv b64>:<auth tag b64>:<ciphertext b64>
 *
 * Why field-level instead of full-disk/TDE?
 * - The database, backups, logs, and any read replica only ever see
 *   ciphertext for the sensitive columns (national id, clinical notes).
 * - A leaked dump or a curious DBA gets nothing without the app-tier key.
 * - GCM is authenticated: tampering with ciphertext fails decryption loudly
 *   instead of silently returning garbage.
 *
 * The key lives ONLY in the ENCRYPTION_KEY env var (32 bytes, hex) — never
 * in the database. Decryption happens in the app tier, after RBAC checks,
 * and every decryption of a national id is audit-logged by the caller.
 */

const PREFIX = "enc:v1:"

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? ""
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    )
  }
  return Buffer.from(hex, "hex")
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
}

export function decryptField(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Defensive: never silently return ciphertext-looking values as plaintext.
    throw new Error("Value is not in a recognized encrypted format.")
  }
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(":")
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted value.")
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivB64, "base64"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))
  const out = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()])
  return out.toString("utf8")
}

/** Mask a national id for roles that may see existence but not the value. */
export function maskNationalId(decrypted: string): string {
  if (decrypted.length <= 4) return "****"
  return `${"*".repeat(decrypted.length - 4)}${decrypted.slice(-4)}`
}
