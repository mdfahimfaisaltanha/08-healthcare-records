import { audit, auditSoft } from "@/lib/audit"
import { createSession, destroySession, getSession, verifyPassword } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/** GET: current session. POST { email, password }: sign in. DELETE: sign out. */

export async function GET() {
  const user = await getSession()
  return Response.json({ user })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string }
  if (!body.email?.trim() || !body.password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 })
  }
  const res = await getPool().query(
    `SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = lower($1)`,
    [body.email.trim()],
  )
  const row = res.rows[0]
  // Same error for unknown email and wrong password — no account enumeration.
  if (!row || !verifyPassword(body.password, row.password_hash)) {
    if (row) {
      auditSoft(
        { id: row.id, name: row.name, email: row.email, role: row.role },
        "auth.login_failed",
        `user:${row.id}`,
      )
    }
    return Response.json({ error: "Invalid email or password." }, { status: 401 })
  }
  await createSession(row.id)
  await audit(
    { id: row.id, name: row.name, email: row.email, role: row.role },
    "auth.login",
    `user:${row.id}`,
  )
  return Response.json({ user: { id: row.id, name: row.name, email: row.email, role: row.role } })
}

export async function DELETE() {
  const user = await getSession()
  if (user) auditSoft(user, "auth.logout", `user:${user.id}`)
  await destroySession()
  return Response.json({ ok: true })
}
