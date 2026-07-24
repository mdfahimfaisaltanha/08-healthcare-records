import { randomBytes, createCipheriv, scryptSync } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"

/**
 * One-shot setup: creates tables and seeds a working clinic —
 * 4 staff accounts (1 admin, 2 doctors, 1 receptionist), 8 patients with
 * AES-256-GCM-encrypted national ids, encrypted visit records, and a week of
 * appointments in every status.
 *
 *   npm run setup
 *
 * Reads DATABASE_URL and ENCRYPTION_KEY from .env.local (or the environment).
 * Safe to re-run: it skips seeding if data already exists.
 */

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* rely on the environment */
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error("\n❌ DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.\n")
  process.exit(1)
}
if (!/^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY ?? "")) {
  console.error("\n❌ ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate one:")
  console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n')
  process.exit(1)
}

const KEY = Buffer.from(process.env.ENCRYPTION_KEY, "hex")
const SEED_PASSWORD = process.env.SEED_PASSWORD || "ChangeMe123!"

/** Mirrors lib/crypto.ts — AES-256-GCM, versioned format. */
function encryptField(plaintext) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", KEY, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`
}

/** Mirrors lib/auth.ts — scrypt with per-user salt. */
function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384 })
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'doctor', 'receptionist')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS patients (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  dob             DATE NOT NULL,
  phone           TEXT NOT NULL DEFAULT '',
  national_id_enc TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS medical_records (
  id         SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id  INTEGER NOT NULL REFERENCES users(id),
  visit_date DATE NOT NULL,
  note_enc   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_id);

CREATE TABLE IF NOT EXISTS appointments (
  id           SERIAL PRIMARY KEY,
  patient_id   INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id    INTEGER NOT NULL REFERENCES users(id),
  starts_at    TIMESTAMPTZ NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'checked_in', 'completed', 'cancelled', 'no_show')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appts_doctor_time ON appointments(doctor_id, starts_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  actor_id   INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action     TEXT NOT NULL,
  resource   TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, id DESC);
`

function daysFromNow(days, hour, minute = 0) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

async function main() {
  console.log("⏳ Creating tables…")
  await pool.query(SCHEMA)

  const existing = await pool.query(`SELECT COUNT(*)::int AS item_count FROM users`)
  if (existing.rows[0].item_count > 0) {
    console.log("ℹ️  Data already exists — skipping seed. (Drop the tables to reseed.)")
    await pool.end()
    return
  }

  console.log("👥 Creating staff accounts…")
  const staff = [
    ["Salma Hossain", "admin@clinic.test", "admin"],
    ["Dr. Imran Rahman", "dr.rahman@clinic.test", "doctor"],
    ["Dr. Grace Chen", "dr.chen@clinic.test", "doctor"],
    ["Rafi Ahmed", "frontdesk@clinic.test", "receptionist"],
  ]
  const staffIds = {}
  for (const [name, email, role] of staff) {
    const r = await pool.query(
      `INSERT INTO users (name, email, role, password_hash) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, email, role, hashPassword(SEED_PASSWORD)],
    )
    staffIds[email] = r.rows[0].id
  }
  const drRahman = staffIds["dr.rahman@clinic.test"]
  const drChen = staffIds["dr.chen@clinic.test"]

  console.log("🩺 Registering patients (national ids encrypted)…")
  const patients = [
    ["Abdullah Al Mamun", "1985-03-12", "+880171000001", "1985123456789"],
    ["Fatima Begum", "1992-07-25", "+880171000002", "1992234567890"],
    ["Joseph Ekwueme", "1978-11-02", "+880171000003", "1978345678901"],
    ["Maria Santos", "2001-01-18", "+880171000004", "2001456789012"],
    ["Kamal Uddin", "1969-05-30", "+880171000005", "1969567890123"],
    ["Nusrat Jahan", "1995-09-14", "+880171000006", "1995678901234"],
    ["David Park", "1988-12-05", "+880171000007", "1988789012345"],
    ["Amina Khatun", "1957-04-22", "+880171000008", "1957890123456"],
  ]
  const patientIds = []
  for (const [name, dob, phone, nid] of patients) {
    const r = await pool.query(
      `INSERT INTO patients (name, dob, phone, national_id_enc) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, dob, phone, encryptField(nid)],
    )
    patientIds.push(r.rows[0].id)
  }

  console.log("📝 Writing encrypted visit records…")
  const records = [
    [0, drRahman, -30, "Follow-up for hypertension. BP 138/88, trending down. Continue amlodipine 5mg. Recheck in 6 weeks. Discussed sodium reduction."],
    [0, drRahman, -84, "Initial consult. BP 152/96 on two readings. Started amlodipine 5mg daily. Baseline labs ordered."],
    [1, drChen, -14, "Migraine without aura, 3 episodes/month. Prescribed sumatriptan 50mg PRN. Headache diary recommended. Review in 8 weeks."],
    [2, drRahman, -7, "Type 2 diabetes review. HbA1c 7.2%, improved from 8.1%. Metformin tolerated well. Reinforced diet plan; annual eye screening referral."],
    [4, drChen, -21, "Chronic lower back pain, no red flags. MRI not indicated. Referred to physiotherapy, 6 sessions. Naproxen 250mg PRN with food."],
    [7, drRahman, -3, "Osteoarthritis of the right knee. Paracetamol regular dosing, topical NSAID added. Discussed weight-bearing exercise program."],
  ]
  for (const [pIdx, doctorId, daysAgo, note] of records) {
    const visitDate = new Date(Date.now() + daysAgo * 86_400_000).toISOString().slice(0, 10)
    await pool.query(
      `INSERT INTO medical_records (patient_id, doctor_id, visit_date, note_enc) VALUES ($1,$2,$3,$4)`,
      [patientIds[pIdx], doctorId, visitDate, encryptField(note)],
    )
  }

  console.log("📅 Booking appointments across the week…")
  const appts = [
    // past, completed / no_show
    [0, drRahman, daysFromNow(-2, 9), 30, "BP follow-up", "completed"],
    [2, drRahman, daysFromNow(-2, 10), 30, "Diabetes review", "completed"],
    [3, drChen, daysFromNow(-1, 14), 30, "New patient consult", "no_show"],
    [5, drChen, daysFromNow(-1, 15), 30, "Skin rash", "completed"],
    // today
    [1, drChen, daysFromNow(0, 16, 30), 30, "Migraine review", "checked_in"],
    [6, drRahman, daysFromNow(0, 17), 30, "Annual physical", "scheduled"],
    // upcoming
    [4, drChen, daysFromNow(1, 9, 30), 45, "Physio progress review", "scheduled"],
    [7, drRahman, daysFromNow(1, 11), 30, "Knee pain follow-up", "scheduled"],
    [3, drChen, daysFromNow(2, 10), 30, "Rebooked consult", "scheduled"],
    [5, drRahman, daysFromNow(3, 9), 30, "Lab results discussion", "cancelled"],
  ]
  for (const [pIdx, doctorId, startsAt, dur, reason, status] of appts) {
    await pool.query(
      `INSERT INTO appointments (patient_id, doctor_id, starts_at, duration_min, reason, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [patientIds[pIdx], doctorId, startsAt, dur, reason, status],
    )
  }

  await pool.query(
    `INSERT INTO audit_log (actor_id, actor_name, actor_role, action, resource, detail)
     VALUES (0, 'system', 'admin', 'system.seed', 'database', 'initial schema + demo data')`,
  )

  console.log(`\n✅ Seeded: 4 staff, ${patients.length} patients (encrypted ids), ${records.length} encrypted records, ${appts.length} appointments.`)
  console.log("\n🔑 Demo accounts (all share the same password):")
  console.log("   admin@clinic.test      — admin (staff + audit log; NO chart access)")
  console.log("   dr.rahman@clinic.test  — doctor")
  console.log("   dr.chen@clinic.test    — doctor")
  console.log("   frontdesk@clinic.test  — receptionist")
  console.log(`   password: ${SEED_PASSWORD}${process.env.SEED_PASSWORD ? "" : "   (default — set SEED_PASSWORD to override)"}`)
  console.log("\n🎉 Setup complete. Run: npm run dev → http://localhost:3000")
  await pool.end()
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message)
  process.exit(1)
})
