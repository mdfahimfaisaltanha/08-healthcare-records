import { auditSoft } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * GET — doctor directory (id + name only) for booking dropdowns.
 * Available to all signed-in staff; deliberately exposes nothing beyond
 * what the schedule board already shows.
 */
export async function GET() {
  const auth = await requireRole("doctor", "receptionist", "admin")
  if (auth instanceof Response) return auth

  const res = await getPool().query(
    `SELECT id, name FROM users WHERE role = 'doctor' ORDER BY name`,
  )
  auditSoft(auth, "doctor.list", "user:doctors", `${res.rows.length} rows`)
  return Response.json({ doctors: res.rows })
}
