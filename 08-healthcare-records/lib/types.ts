/** Shared types. */

export type Role = "admin" | "doctor" | "receptionist"

export type SessionUser = {
  id: number
  name: string
  email: string
  role: Role
}

export type PatientListItem = {
  id: number
  name: string
  dob: string
  phone: string
  /** Masked for receptionists, full for doctors, absent for admins. */
  nationalId: string | null
}

export type MedicalRecord = {
  id: number
  patientId: number
  doctorName: string
  visitDate: string
  /** Decrypted clinical note — only ever present for doctors. */
  note: string
  createdAt: string
}

export type Appointment = {
  id: number
  patientId: number
  patientName: string
  doctorId: number
  doctorName: string
  startsAt: string
  durationMin: number
  reason: string
  status: "scheduled" | "checked_in" | "completed" | "cancelled" | "no_show"
}

export type AuditEntry = {
  id: number
  actorName: string
  actorRole: Role
  action: string
  resource: string
  detail: string
  createdAt: string
}
