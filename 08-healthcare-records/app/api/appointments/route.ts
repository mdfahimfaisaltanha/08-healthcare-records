import { audit, auditSoft } from "@/lib/audit"
import { requireRole } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

const STATUSES = ["scheduled", "checked_in", "completed", "cancelled", "no_show"]

/**
 * GET: appointments — doctors see only their own schedule; receptionists and
 *      admins see the whole board.
 * POST: book (receptionist/admin). Double-booking a doctor is rejected with
 *       409 by checking time-range overlap against non-cancelled appointments.
 * PATCH { id, status }: workflow updates. Receptionists handle check-in and
 *       cancellations; doctors can complete or no-show their own visits.
 */

export async function GET() {
  const auth = await requireRole("doctor", "receptionist", "admin")
  if (auth instanceof Response) return auth

  const res = await getPool().query(
    `SELECT a.id, a.patient_id, p.name AS patient_name, a.doctor_id, u.name AS doctor_name,
            a.starts_at, a.duration_min, a.reason, a.status
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN users u ON u.id = a.doctor_id
     ${auth.role === "doctor" ? "WHERE a.doctor_id = $1" : ""}
     ORDER BY a.starts_at DESC
     LIMIT 200`,
    auth.role === "doctor" ? [auth.id] : [],
  )
  auditSoft(auth, "appointment.list", "appointment:*", `${res.rows.length} rows`)
  return Response.json({
    appointments: res.rows.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      patientName: r.patient_name,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      startsAt: r.starts_at,
      durationMin: r.duration_min,
      reason: r.reason,
      status: r.status,
    })),
  })
}

export async function POST(req: Request) {
  const auth = await requireRole("receptionist", "admin")
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as {
    patientId?: number
    doctorId?: number
    startsAt?: string
    durationMin?: number
    reason?: string
  }
  const durationMin = Number.isInteger(body.durationMin) && (body.durationMin as number) > 0
    ? Math.min(body.durationMin as number, 240)
    : 30
  if (!Number.isInteger(body.patientId) || !Number.isInteger(body.doctorId) || !body.startsAt) {
    return Response.json({ error: "patientId, doctorId, and startsAt are required." }, { status: 400 })
  }
  const starts = new Date(body.startsAt)
  if (Number.isNaN(starts.getTime())) {
    return Response.json({ error: "startsAt must be a valid datetime." }, { status: 400 })
  }
  if (starts.getTime() < Date.now() - 60_000) {
    return Response.json({ error: "Cannot book an appointment in the past." }, { status: 400 })
  }

  const pool = getPool()
  const doctor = await pool.query(`SELECT id, name FROM users WHERE id = $1 AND role = 'doctor'`, [body.doctorId])
  if (doctor.rows.length === 0) {
    return Response.json({ error: "doctorId does not refer to a doctor." }, { status: 400 })
  }

  // Double-booking guard: overlap against the doctor's non-cancelled slots.
  const clash = await pool.query(
    `SELECT a.id, a.starts_at, p.name AS patient_name
     FROM appointments a JOIN patients p ON p.id = a.patient_id
     WHERE a.doctor_id = $1
       AND a.status NOT IN ('cancelled', 'no_show')
       AND a.starts_at < $2::timestamptz + ($3 || ' minutes')::interval
       AND a.starts_at + (a.duration_min || ' minutes')::interval > $2::timestamptz`,
    [body.doctorId, starts.toISOString(), durationMin],
  )
  if (clash.rows.length > 0) {
    return Response.json(
      { error: `Dr. ${doctor.rows[0].name} is already booked at that time (${clash.rows[0].patient_name}). Pick another slot.` },
      { status: 409 },
    )
  }

  const res = await pool.query(
    `INSERT INTO appointments (patient_id, doctor_id, starts_at, duration_min, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [body.patientId, body.doctorId, starts.toISOString(), durationMin, body.reason?.trim() ?? ""],
  )
  await audit(auth, "appointment.create", `appointment:${res.rows[0].id}`, `patient:${body.patientId} doctor:${body.doctorId} at ${starts.toISOString()}`)
  return Response.json({ ok: true, id: res.rows[0].id })
}

export async function PATCH(req: Request) {
  const auth = await requireRole("doctor", "receptionist", "admin")
  if (auth instanceof Response) return auth

  const body = (await req.json().catch(() => ({}))) as { id?: number; status?: string }
  if (!Number.isInteger(body.id) || !STATUSES.includes(body.status ?? "")) {
    return Response.json({ error: `Pass { id, status } with status one of: ${STATUSES.join(", ")}.` }, { status: 400 })
  }

  // Role-scoped transitions: doctors manage clinical outcomes of their own
  // visits; front desk manages logistics.
  const allowed = auth.role === "doctor" ? ["completed", "no_show"] : ["scheduled", "checked_in", "cancelled"]
  if (!allowed.includes(body.status as string)) {
    return Response.json(
      { error: `A ${auth.role} can only set status to: ${allowed.join(", ")}.` },
      { status: 403 },
    )
  }

  const res = await getPool().query(
    `UPDATE appointments SET status = $2 WHERE id = $1 ${auth.role === "doctor" ? "AND doctor_id = $3" : ""} RETURNING id`,
    auth.role === "doctor" ? [body.id, body.status, auth.id] : [body.id, body.status],
  )
  if (res.rows.length === 0) {
    return Response.json({ error: "Appointment not found (or not yours to update)." }, { status: 404 })
  }
  await audit(auth, "appointment.status_change", `appointment:${body.id}`, `-> ${body.status}`)
  return Response.json({ ok: true })
}
