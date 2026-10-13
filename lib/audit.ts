import { getPool } from "@/lib/db"
import type { SessionUser } from "@/lib/types"

/**
 * Append-only audit trail.
 *
 * Every sensitive operation writes a row: who (id + name + role snapshot),
 * what (action), on what (resource), and any detail. There is no UPDATE or
 * DELETE path anywhere in the codebase for this table, and the setup script
 * REVOKEs UPDATE/DELETE from the app's own role where permissions allow —
 * the audit log only grows.
 *
 * Logged actions include:
 *   auth.login / auth.login_failed / auth.logout
 *   patient.create / patient.view / patient.national_id_decrypt
 *   record.create / record.view
 *   appointment.create / appointment.status_change
 *   user.create / audit.view
 *
 * Audit writes are awaited (not fire-and-forget) for writes to PHI, so a
 * failed audit insert fails the operation — "no log, no access" — but reads
 * of non-PHI lists use best-effort logging to keep the app usable.
 */
export async function audit(
  actor: SessionUser,
  action: string,
  resource: string,
  detail = "",
): Promise<void> {
  await getPool().query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, resource, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.id, actor.name, actor.role, action, resource, detail],
  )
}

/** Best-effort variant for non-PHI reads — never blocks the response. */
export function auditSoft(
  actor: SessionUser,
  action: string,
  resource: string,
  detail = "",
): void {
  void audit(actor, action, resource, detail).catch(() => {})
}
