import { auditSoft } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * GET — the audit trail (admin only, newest first, filterable).
 * Reading the audit log is itself audited — watchers are watched.
 */
export async function GET(req: Request) {
  const auth = await requireRole("admin")
  if (auth instanceof Response) return auth

  const url = new URL(req.url)
  const action = url.searchParams.get("action")
  const actor = url.searchParams.get("actor")

  const where: string[] = []
  const params: unknown[] = []
  if (action) {
    params.push(`${action}%`)
    where.push(`action LIKE $${params.length}`)
  }
  if (actor) {
    params.push(`%${actor}%`)
    where.push(`actor_name ILIKE $${params.length}`)
  }

  const res = await getPool().query(
    `SELECT id, actor_name, actor_role, action, resource, detail, created_at
     FROM audit_log
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY id DESC LIMIT 300`,
    params,
  )

  auditSoft(auth, "audit.view", "audit_log", `${res.rows.length} rows${action ? ` action=${action}` : ""}`)

  return Response.json({
    entries: res.rows.map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      actorRole: r.actor_role,
      action: r.action,
      resource: r.resource,
      detail: r.detail,
      createdAt: r.created_at,
    })),
  })
}
