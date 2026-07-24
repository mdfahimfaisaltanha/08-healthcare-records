"use client"

import { useCallback, useEffect, useState } from "react"
import type { Appointment, AuditEntry, MedicalRecord, PatientListItem, SessionUser } from "@/lib/types"

type Tab = "appointments" | "patients" | "audit" | "users"
type StaffUser = { id: number; name: string; email: string; role: string; createdAt: string }

const fmtDt = (d: string) =>
  new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })

const STATUS_BADGE: Record<string, string> = {
  scheduled: "info", checked_in: "warn", completed: "ok", cancelled: "muted", no_show: "bad",
  admin: "bad", doctor: "ok", receptionist: "info",
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${STATUS_BADGE[value] ?? "muted"}`}>{value.replace(/_/g, " ")}</span>
}

export default function ClinicPortal() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [tab, setTab] = useState<Tab>("appointments")
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [patients, setPatients] = useState<PatientListItem[]>([])
  const [staff, setStaff] = useState<StaffUser[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [chart, setChart] = useState<{ patient: PatientListItem; records: MedicalRecord[]; canReadNotes: boolean } | null>(null)

  // forms
  const [pName, setPName] = useState("")
  const [pDob, setPDob] = useState("")
  const [pPhone, setPPhone] = useState("")
  const [pNid, setPNid] = useState("")
  const [aPatient, setAPatient] = useState("")
  const [aDoctor, setADoctor] = useState("")
  const [aStart, setAStart] = useState("")
  const [aDuration, setADuration] = useState("30")
  const [aReason, setAReason] = useState("")
  const [noteText, setNoteText] = useState("")
  const [uName, setUName] = useState("")
  const [uEmail, setUEmail] = useState("")
  const [uRole, setURole] = useState("receptionist")
  const [uPassword, setUPassword] = useState("")
  const [auditFilter, setAuditFilter] = useState("")
  const [doctors, setDoctors] = useState<{ id: number; name: string }[]>([])

  const refresh = useCallback(async (u: SessionUser) => {
    setError(null)
    const jobs: Promise<void>[] = [
      fetch("/api/appointments").then(async (r) => {
        if (r.ok) setAppointments((await r.json()).appointments)
      }),
      fetch("/api/patients").then(async (r) => {
        if (r.ok) setPatients((await r.json()).patients)
      }),
      fetch("/api/doctors").then(async (r) => {
        if (r.ok) setDoctors((await r.json()).doctors)
      }),
    ]
    if (u.role === "admin") {
      jobs.push(
        fetch("/api/users").then(async (r) => {
          if (r.ok) setStaff((await r.json()).users)
        }),
        fetch(`/api/audit${auditFilter ? `?action=${encodeURIComponent(auditFilter)}` : ""}`).then(async (r) => {
          if (r.ok) setAuditEntries((await r.json()).entries)
        }),
      )
    }
    await Promise.all(jobs).catch(() => setError("Failed to load data. Did you run `npm run setup`?"))
  }, [auditFilter])

  useEffect(() => {
    fetch("/api/login")
      .then(async (r) => {
        const data = await r.json()
        setUser(data.user)
        if (data.user) void refresh(data.user)
      })
      .catch(() => setUser(null))
  }, [refresh])

  async function post(url: string, body: unknown, method = "POST"): Promise<Record<string, unknown> | null> {
    setError(null)
    setNotice(null)
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError((data as { error?: string }).error || "Request failed.")
      return null
    }
    if (user) void refresh(user)
    return data as Record<string, unknown>
  }

  async function login(e: React.FormEvent) {
    e.preventDefault()
    const data = await post("/api/login", { email, password })
    if (data?.user) {
      setUser(data.user as SessionUser)
      setPassword("")
      void refresh(data.user as SessionUser)
    }
  }

  async function openChart(patientId: number) {
    setError(null)
    const res = await fetch(`/api/patients/${patientId}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Failed to open chart.")
      return
    }
    setChart(data)
    setNoteText("")
  }

  if (user === undefined) return <main className="container"><p className="meta">Loading…</p></main>

  if (!user) {
    return (
      <main className="container">
        <div className="login-wrap card">
          <h2>🏥 ClinicOS</h2>
          <p className="meta" style={{ marginBottom: 14 }}>
            Sign in as any seeded account — admin@clinic.test, dr.rahman@clinic.test, dr.chen@clinic.test, or frontdesk@clinic.test (password printed by <code>npm run setup</code>).
          </p>
          <form className="row" onSubmit={login}>
            <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
            <button className="primary" type="submit">Sign in</button>
          </form>
          {error && <div className="error-box">⛔ {error}</div>}
        </div>
      </main>
    )
  }

  const tabs: [Tab, string][] = [
    ["appointments", "📅 Appointments"],
    ["patients", "🩺 Patients"],
  ]
  if (user.role === "admin") {
    tabs.push(["users", "👥 Staff"], ["audit", "📜 Audit log"])
  }

  return (
    <main className="container">
      <div className="topbar">
        <div>
          <h1>🏥 ClinicOS</h1>
          <div className="sub">
            Signed in as <strong>{user.name}</strong> <Badge value={user.role} />
          </div>
        </div>
        <button
          className="ghost"
          onClick={async () => {
            await fetch("/api/login", { method: "DELETE" })
            setUser(null)
            setChart(null)
          }}
        >
          Sign out
        </button>
      </div>

      <div className="tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setError(null); setNotice(null) }}>{label}</button>
        ))}
      </div>

      {error && <div className="error-box">⛔ {error}</div>}
      {notice && <div className="ok-box">✅ {notice}</div>}

      {tab === "appointments" && (
        <>
          {(user.role === "receptionist" || user.role === "admin") && (
            <div className="card">
              <h2>Book appointment</h2>
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const ok = await post("/api/appointments", {
                    patientId: Number(aPatient),
                    doctorId: Number(aDoctor),
                    startsAt: aStart,
                    durationMin: Number(aDuration),
                    reason: aReason,
                  })
                  if (ok) {
                    setAReason("")
                    setNotice("Appointment booked.")
                  }
                }}
              >
                <select value={aPatient} onChange={(e) => setAPatient(e.target.value)}>
                  <option value="">Patient…</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={aDoctor} onChange={(e) => setADoctor(e.target.value)}>
                  <option value="">Doctor…</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <input type="datetime-local" value={aStart} onChange={(e) => setAStart(e.target.value)} />
                <input type="number" min={10} max={240} step={5} value={aDuration} onChange={(e) => setADuration(e.target.value)} style={{ width: 90 }} title="Duration (minutes)" />
                <input placeholder="Reason" value={aReason} onChange={(e) => setAReason(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                <button className="primary" type="submit" disabled={!aPatient || !aDoctor || !aStart}>Book</button>
              </form>
              <p className="meta" style={{ marginTop: 8 }}>Double-booking a doctor is rejected with a 409 naming the conflicting patient.</p>
            </div>
          )}

          <div className="card">
            <h2>{user.role === "doctor" ? "My schedule" : "All appointments"} ({appointments.length})</h2>
            <table>
              <thead><tr><th>When</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td>{fmtDt(a.startsAt)}<div className="meta">{a.durationMin} min</div></td>
                    <td>{a.patientName}</td>
                    <td>{a.doctorName}</td>
                    <td>{a.reason || <span className="meta">—</span>}</td>
                    <td><Badge value={a.status} /></td>
                    <td className="row">
                      {user.role !== "doctor" && a.status === "scheduled" && (
                        <>
                          <button className="ghost" onClick={() => post("/api/appointments", { id: a.id, status: "checked_in" }, "PATCH")}>Check in</button>
                          <button className="ghost" onClick={() => post("/api/appointments", { id: a.id, status: "cancelled" }, "PATCH")}>Cancel</button>
                        </>
                      )}
                      {user.role === "doctor" && (a.status === "scheduled" || a.status === "checked_in") && (
                        <>
                          <button className="ghost" onClick={() => post("/api/appointments", { id: a.id, status: "completed" }, "PATCH")}>Complete</button>
                          <button className="ghost" onClick={() => post("/api/appointments", { id: a.id, status: "no_show" }, "PATCH")}>No-show</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "patients" && (
        <>
          {(user.role === "receptionist" || user.role === "admin") && (
            <div className="card">
              <h2>Register patient</h2>
              <form
                className="row"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const ok = await post("/api/patients", { name: pName, dob: pDob, phone: pPhone, nationalId: pNid })
                  if (ok) {
                    setPName(""); setPDob(""); setPPhone(""); setPNid("")
                    setNotice("Patient registered — national id encrypted at rest.")
                  }
                }}
              >
                <input placeholder="Full name" value={pName} onChange={(e) => setPName(e.target.value)} />
                <input type="date" value={pDob} onChange={(e) => setPDob(e.target.value)} title="Date of birth" />
                <input placeholder="Phone" value={pPhone} onChange={(e) => setPPhone(e.target.value)} style={{ width: 140 }} />
                <input placeholder="National ID" value={pNid} onChange={(e) => setPNid(e.target.value)} style={{ width: 160 }} />
                <button className="primary" type="submit">Register</button>
              </form>
            </div>
          )}

          <div className="card">
            <h2>Patients ({patients.length})</h2>
            {user.role === "admin" && <p className="meta" style={{ marginBottom: 8 }}>As admin you see demographics only — no national ids, and charts are off-limits (least privilege).</p>}
            <table>
              <thead><tr><th>Name</th><th>DOB</th><th>Phone</th><th>National ID</th><th></th></tr></thead>
              <tbody>
                {patients.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{fmtDate(p.dob)}</td>
                    <td>{p.phone || <span className="meta">—</span>}</td>
                    <td className="mono">{p.nationalId ?? <span className="meta">hidden for admins</span>}</td>
                    <td>{user.role !== "admin" && <button className="ghost" onClick={() => openChart(p.id)}>Open chart</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chart && (
            <div className="card">
              <div className="topbar">
                <h2 style={{ marginBottom: 0 }}>🩺 Chart — {chart.patient.name} <span className="mono">{chart.patient.nationalId}</span></h2>
                <button className="ghost" onClick={() => setChart(null)}>Close</button>
              </div>
              {!chart.canReadNotes && (
                <p className="meta" style={{ marginTop: 8 }}>
                  Visit history metadata only — clinical note bodies are never decrypted for the front desk.
                </p>
              )}
              {chart.records.length === 0 && <p className="meta" style={{ marginTop: 10 }}>No visit records yet.</p>}
              {chart.records.map((r) => (
                <div key={r.id} style={{ marginTop: 12 }}>
                  <div className="meta"><strong style={{ color: "var(--text)" }}>{fmtDate(r.visitDate)}</strong> · {r.doctorName}</div>
                  {chart.canReadNotes && <div className="note-body">{r.note}</div>}
                </div>
              ))}
              {user.role === "doctor" && (
                <form
                  style={{ marginTop: 16 }}
                  onSubmit={async (e) => {
                    e.preventDefault()
                    const ok = await post("/api/records", { patientId: chart.patient.id, note: noteText })
                    if (ok) {
                      setNotice("Record saved — note encrypted at rest, write audit-logged.")
                      void openChart(chart.patient.id)
                    }
                  }}
                >
                  <textarea placeholder="New clinical note (encrypted with AES-256-GCM before it reaches the database)…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="primary" type="submit" disabled={!noteText.trim()}>Add record</button>
                    <span className="meta">Records are append-only — corrections are new records.</span>
                  </div>
                </form>
              )}
            </div>
          )}
        </>
      )}

      {tab === "users" && user.role === "admin" && (
        <>
          <div className="card">
            <h2>Add staff member</h2>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault()
                const ok = await post("/api/users", { name: uName, email: uEmail, role: uRole, password: uPassword })
                if (ok) {
                  setUName(""); setUEmail(""); setUPassword("")
                  setNotice("Staff account created.")
                }
              }}
            >
              <input placeholder="Name" value={uName} onChange={(e) => setUName(e.target.value)} />
              <input placeholder="Email" value={uEmail} onChange={(e) => setUEmail(e.target.value)} />
              <select value={uRole} onChange={(e) => setURole(e.target.value)}>
                <option value="receptionist">receptionist</option>
                <option value="doctor">doctor</option>
                <option value="admin">admin</option>
              </select>
              <input type="password" placeholder="Password (min 10 chars)" value={uPassword} onChange={(e) => setUPassword(e.target.value)} />
              <button className="primary" type="submit">Create</button>
            </form>
          </div>
          <div className="card">
            <h2>Staff ({staff.length})</h2>
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Since</th></tr></thead>
              <tbody>
                {staff.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.email}</td>
                    <td><Badge value={s.role} /></td>
                    <td>{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "audit" && user.role === "admin" && (
        <div className="card">
          <div className="topbar">
            <h2 style={{ marginBottom: 0 }}>📜 Audit log (append-only, newest first)</h2>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                void refresh(user)
              }}
            >
              <select value={auditFilter} onChange={(e) => setAuditFilter(e.target.value)}>
                <option value="">All actions</option>
                <option value="auth">auth.*</option>
                <option value="patient">patient.*</option>
                <option value="record">record.*</option>
                <option value="appointment">appointment.*</option>
                <option value="user">user.*</option>
                <option value="audit">audit.*</option>
              </select>
              <button className="ghost" type="submit">Filter</button>
            </form>
          </div>
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Detail</th></tr></thead>
            <tbody>
              {auditEntries.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDt(a.createdAt)}</td>
                  <td>{a.actorName} <Badge value={a.actorRole} /></td>
                  <td className="mono">{a.action}</td>
                  <td className="mono">{a.resource}</td>
                  <td className="meta">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta" style={{ marginTop: 10 }}>Note the <code>audit.view</code> rows — reading this log is itself logged.</p>
        </div>
      )}
    </main>
  )
}
