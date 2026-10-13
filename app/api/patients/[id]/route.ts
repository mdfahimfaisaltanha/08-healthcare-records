import { audit } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { decryptField, maskNationalId } from "@/lib/crypto"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * GET /api/patients/:id — patient chart.
 *
 * RBAC:
 *   - doctor:       demographics + full national id + decrypted medical
 *                   records (every note decrypt is audit-logged)
 *   - receptionist: demographics + masked national id; records show
 *                   metadata only (visit date, doctor) — note bodies are
 *                   NEVER decrypted for this role
 *   - admin:        404-equivalent forbidden — admins have no clinical need
 *                   to open charts (least privilege, and it reads better in
 *                   an interview than "admin sees everything")
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole("doctor", "receptionist")
  if (auth instanceof Response) return auth

  const id = Number(params.id)
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid patient id." }, { status: 400 })
  }

  const res = await getPool().query(
    `SELECT id, name, dob, phone, national_id_enc FROM patients WHERE id = $1`,
    [id],
  )
  if (res.rows.length === 0) {
    return Response.json({ error: "Patient not found." }, { status: 404 })
  }
  const p = res.rows[0]

  const recordsRes = await getPool().query(
    `SELECT r.id, r.patient_id, u.name AS doctor_name, r.visit_date, r.note_enc, r.created_at
     FROM medical_records r JOIN users u ON u.id = r.doctor_id
     WHERE r.patient_id = $1 ORDER BY r.visit_date DESC, r.id DESC`,
    [id],
  )

  const isDoctor = auth.role === "doctor"
  const nationalId = isDoctor
    ? decryptField(p.national_id_enc)
    : maskNationalId(decryptField(p.national_id_enc))

  const records = recordsRes.rows.map((r) => ({
    id: r.id,
    patientId: r.patient_id,
    doctorName: r.doctor_name,
    visitDate: r.visit_date,
    // Clinical note bodies are decrypted for doctors only.
    note: isDoctor ? decryptField(r.note_enc) : "",
    createdAt: r.created_at,
  }))

  // PHI access — hard audit: if this insert fails, the request fails.
  await audit(
    auth,
    isDoctor ? "record.view" : "patient.view",
    `patient:${id}`,
    isDoctor ? `chart + ${records.length} notes decrypted` : "demographics (masked id)",
  )

  return Response.json({
    patient: { id: p.id, name: p.name, dob: p.dob, phone: p.phone, nationalId },
    records,
    canReadNotes: isDoctor,
  })
}
