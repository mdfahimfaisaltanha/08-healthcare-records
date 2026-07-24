import { audit } from "@/lib/audit"
import { hashPassword, requireRole } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

const ROLES = ["admin", "doctor", "receptionist"]

/** Admin-only staff management. GET: list users. POST: create a user. */

export async function GET() {
  const auth = await requireRole("admin")
  if (auth instanceof Response) return auth
  const res = await getPool().query(
    `SELECT id, name, email, role, created_at FROM users ORDER BY role, name`,
  )
  return Response.json({
    users: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
    })),
  })
}

export async function POST(req: Request) {
  const auth = await requireRole("admin")
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    email?: string
    role?: string
    password?: string
  }
  if (!body.name?.trim() || !body.email?.trim() || !ROLES.includes(body.role ?? "")) {
    return Response.json({ error: `name, email, and role (${ROLES.join(" | ")}) are required.` }, { status: 400 })
  }
  if (!body.password || body.password.length < 10) {
    return Response.json({ error: "Password must be at least 10 characters." }, { status: 400 })
  }

  const existing = await getPool().query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [body.email.trim()])
  if (existing.rows.length > 0) {
    return Response.json({ error: "A user with that email already exists." }, { status: 409 })
  }

  const res = await getPool().query(
    `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.name.trim(), body.email.trim().toLowerCase(), body.role, hashPassword(body.password)],
  )
  await audit(auth, "user.create", `user:${res.rows[0].id}`, `${body.email.trim()} as ${body.role}`)
  return Response.json({ ok: true, id: res.rows[0].id })
}
