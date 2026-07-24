import { audit } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { encryptField } from "@/lib/crypto"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * POST — create a medical record (doctors only).
 * The clinical note is AES-256-GCM encrypted before insert; the database
 * never sees plaintext. Records are immutable once written — there is no
 * UPDATE/DELETE route (append-only, like the audit log): corrections are
 * new records, which is how clinical systems actually work.
 */
export async function POST(req: Request) {
  const auth = await requireRole("doctor")
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as {
    patientId?: number
    visitDate?: string
    note?: string
  }
  if (!Number.isInteger(body.patientId) || !body.note?.trim()) {
    return Response.json({ error: "patientId and note are required." }, { status: 400 })
  }
  if (body.note.trim().length > 10_000) {
    return Response.json({ error: "Note is too long (max 10,000 characters)." }, { status: 400 })
  }
  const visitDate = body.visitDate && /^\d{4}-\d{2}-\d{2}$/.test(body.visitDate)
    ? body.visitDate
    : new Date().toISOString().slice(0, 10)

  const patient = await getPool().query(`SELECT id FROM patients WHERE id = $1`, [body.patientId])
  if (patient.rows.length === 0) {
    return Response.json({ error: "Patient not found." }, { status: 404 })
  }

  const res = await getPool().query(
    `INSERT INTO medical_records (patient_id, doctor_id, visit_date, note_enc)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.patientId, auth.id, visitDate, encryptField(body.note.trim())],
  )
  await audit(auth, "record.create", `patient:${body.patientId}`, `record:${res.rows[0].id} (${visitDate})`)
  return Response.json({ ok: true, id: res.rows[0].id })
}
