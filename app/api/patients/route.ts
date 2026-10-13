import { audit, auditSoft } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { decryptField, encryptField, maskNationalId } from "@/lib/crypto"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * GET: patient list — field visibility depends on role (RBAC matrix in README):
 *   - doctor:       full national id (each decrypt is audit-logged)
 *   - receptionist: masked national id (last 4)
 *   - admin:        no national id at all — admins run the system, they
 *                   don't treat patients (least privilege)
 * POST: register a patient (receptionist or admin). National id is encrypted
 *       with AES-256-GCM before it ever touches the database.
 */

export async function GET() {
  const auth = await requireRole("doctor", "receptionist", "admin")
  if (auth instanceof Response) return auth

  const res = await getPool().query(
    `SELECT id, name, dob, phone, national_id_enc FROM patients ORDER BY name`,
  )

  const patients = res.rows.map((r) => {
    let nationalId: string | null = null
    if (auth.role === "doctor") nationalId = decryptField(r.national_id_enc)
    else if (auth.role === "receptionist") nationalId = maskNationalId(decryptField(r.national_id_enc))
    return { id: r.id, name: r.name, dob: r.dob, phone: r.phone, nationalId }
  })

  if (auth.role === "doctor") {
    // Bulk decrypt of identifiers is a PHI access event — log it hard.
    await audit(auth, "patient.national_id_decrypt", "patient:*", `list of ${patients.length}`)
  } else {
    auditSoft(auth, "patient.list", "patient:*", `${patients.length} rows`)
  }

  return Response.json({ patients })
}

export async function POST(req: Request) {
  const auth = await requireRole("receptionist", "admin")
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    dob?: string
    phone?: string
    nationalId?: string
  }
  if (!body.name?.trim() || !body.dob || !body.nationalId?.trim()) {
    return Response.json({ error: "name, dob, and nationalId are required." }, { status: 400 })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dob) || new Date(body.dob) > new Date()) {
    return Response.json({ error: "dob must be a past date in YYYY-MM-DD format." }, { status: 400 })
  }

  const res = await getPool().query(
    `INSERT INTO patients (name, dob, phone, national_id_enc) VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.name.trim(), body.dob, body.phone?.trim() ?? "", encryptField(body.nationalId.trim())],
  )
  await audit(auth, "patient.create", `patient:${res.rows[0].id}`, body.name.trim())
  return Response.json({ ok: true, id: res.rows[0].id })
}
