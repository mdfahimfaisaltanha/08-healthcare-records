import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { getPool } from "@/lib/db"
import type { Role, SessionUser } from "@/lib/types"

/**
 * Multi-user auth + RBAC.
 *
 * - Passwords: scrypt (N=16384) with a per-user random 16-byte salt, stored
 *   as `scrypt:<salt hex>:<hash hex>`. Verified with timingSafeEqual.
 * - Sessions: 32-byte random token in an httpOnly cookie; only the SHA-less
 *   raw token's scrypt-free lookup is avoided by storing the token itself
 *   hashed? No — tokens are random (not user-chosen), so we store them
 *   directly and index them; they carry no offline-crack value beyond the
 *   session itself, and expiry is enforced server-side (8h).
 * - RBAC: requireRole(...) returns the session user or a ready-to-return
 *   401/403 Response. Route handlers stay one-liner-guarded.
 */

const SESSION_COOKIE = "clinic_session"
const SESSION_HOURS = 8

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384 })
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":")
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, "hex")
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384 })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("hex")
  await getPool().query(
    `INSERT INTO sessions (token, user_id, expires_at)
     VALUES ($1, $2, now() + interval '${SESSION_HOURS} hours')`,
    [token, userId],
  )
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_HOURS * 3600,
    path: "/",
  })
}

export async function destroySession(): Promise<void> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (token) {
    await getPool().query(`DELETE FROM sessions WHERE token = $1`, [token]).catch(() => {})
  }
  cookies().delete(SESSION_COOKIE)
}

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null
  const res = await getPool().query(
    `SELECT u.id, u.name, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  )
  if (res.rows.length === 0) return null
  const r = res.rows[0]
  return { id: r.id, name: r.name, email: r.email, role: r.role }
}

/**
 * RBAC guard. Usage:
 *   const auth = await requireRole("doctor", "admin")
 *   if (auth instanceof Response) return auth
 *   // auth is the SessionUser
 */
export async function requireRole(...roles: Role[]): Promise<SessionUser | Response> {
  const user = await getSession()
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 })
  }
  if (roles.length > 0 && !roles.includes(user.role)) {
    return Response.json(
      { error: `Forbidden: requires role ${roles.join(" or ")} (you are ${user.role}).` },
      { status: 403 },
    )
  }
  return user
}
