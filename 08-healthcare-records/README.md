# Healthcare Appointment & Records System (“ClinicOS”)

A clinic portal with **role-based access control**, **field-level AES-256-GCM encryption** for PHI, and an **append-only audit log** — plus appointment scheduling with double-booking prevention and immutable medical records.

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Postgres**. No auth or crypto libraries — sessions, scrypt password hashing, and AES-256-GCM are implemented directly on Node's `crypto`, so every security decision is visible and defensible.

> Demo system, not a certified medical device — but the security architecture (least privilege, encrypt-then-store, audit-everything) is the real pattern behind HIPAA-style technical safeguards.

---

## Quick start

```bash
npm install
cp .env.example .env.local
# set DATABASE_URL (Neon/Supabase free tier) and ENCRYPTION_KEY:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run setup     # tables + 4 staff, 8 patients, encrypted records, a week of appointments
npm run dev       # http://localhost:3000
```

Sign in with the accounts printed by setup (`admin@clinic.test`, `dr.abdurrahman@clinic.test`, `dr.chen@clinic.test`, `frontdesk@clinic.test`). A role-by-role demo script is in `samples/walkthrough.md`.

---

## The RBAC matrix

| Capability | Receptionist | Doctor | Admin |
|---|---|---|---|
| Register patients | ✅ | ❌ | ✅ |
| View patient demographics | ✅ | ✅ | ✅ |
| View national ID | masked (last 4) | ✅ full (audited) | ❌ none |
| Open patient chart | metadata only | ✅ with decrypted notes | ❌ forbidden |
| Write medical records | ❌ | ✅ | ❌ |
| Book / check in / cancel appointments | ✅ | ❌ | ✅ |
| Complete / no-show appointments | ❌ | ✅ own only | ❌ |
| View schedule | all | own only | all |
| Manage staff accounts | ❌ | ❌ | ✅ |
| Read audit log | ❌ | ❌ | ✅ (audited) |

The interview-worthy row is the admin column: **admins run the system but cannot read charts, notes, or national ids.** Least privilege means role power is scoped to job function, not stacked hierarchically. Enforcement lives server-side in `requireRole(...)` guards plus per-role SQL scoping (doctors' schedule queries are filtered by `doctor_id` in SQL, not in the client).

## Field-level encryption (`lib/crypto.ts`)

- **What's encrypted:** patient national ids and clinical note bodies — the two highest-value PHI fields. Demographics stay queryable plaintext (you need to search patients by name).
- **How:** AES-256-GCM, fresh random 12-byte IV per value, stored as `enc:v1:<iv>:<tag>:<ciphertext>`. The `v1` prefix makes key rotation a tractable migration instead of a crisis.
- **Why GCM:** authenticated encryption — a tampered ciphertext fails loudly at decrypt instead of silently returning garbage clinical text.
- **Key handling:** 32-byte key lives only in `ENCRYPTION_KEY` (app tier). The database, its backups, replicas, and logs only ever contain ciphertext; a leaked dump exposes nothing.
- **Decryption is role-gated:** it happens after RBAC checks, and decrypting identifiers or notes writes an audit row.

## Audit logging (`lib/audit.ts`)

- Append-only: no UPDATE/DELETE path exists in the codebase for `audit_log`.
- **“No log, no access”:** audit inserts for PHI reads/writes are awaited — if the audit write fails, the request fails. Non-PHI listings use best-effort logging so the app stays usable.
- Every row snapshots actor id, name, and role at event time (role changes later don't rewrite history).
- Reading the audit log writes an `audit.view` row — watchers are watched.
- Filterable by action prefix and actor from the admin UI.

## Auth (`lib/auth.ts`)

- Passwords: scrypt (N=16384), per-user 16-byte salt, `timingSafeEqual` comparison.
- Sessions: 32-byte random tokens, httpOnly + SameSite cookies, 8-hour server-side expiry.
- Login returns the same error for unknown email and wrong password — no account enumeration. Failed attempts on real accounts are audit-logged.

## Edge cases handled

| Case | Behavior |
|---|---|
| Double-booking a doctor | 409 with the conflicting patient's name (time-range overlap check, cancelled/no-show slots don't block) |
| Booking in the past | 400 |
| Doctor updating another doctor's appointment | 404 — the UPDATE is scoped by `doctor_id` in SQL |
| Receptionist requesting note bodies | Notes are never decrypted server-side for that role — not just hidden in the UI |
| Admin opening a chart | 403 before any DB read |
| Tampered ciphertext in DB | GCM auth tag fails → loud 500, never silent garbage |
| Audit insert fails during PHI access | The access fails too (“no log, no access”) |
| Duplicate staff email | 409 |
| Session expiry | Enforced in SQL (`expires_at > now()`), not just cookie maxAge |
| Record edits | Impossible — records are append-only; corrections are new records |

## Data model

`users(role CHECK)` · `sessions(token, expires_at)` · `patients(national_id_enc)` · `medical_records(note_enc, append-only)` · `appointments(status CHECK, overlap-guarded)` · `audit_log(append-only)`

## Deployment (Vercel + Neon)

1. Free Postgres at [neon.tech](https://neon.tech) → set `DATABASE_URL`.
2. Generate `ENCRYPTION_KEY` (command above) — store it in Vercel env vars, never in git.
3. `npm run setup` against the database.
4. Push to GitHub → import in Vercel → set both env vars → deploy.

## Limitations / roadmap

- No patient-facing portal — patients are records, not users; adding a `patient` role with self-serve booking is the natural extension.
- Key rotation is designed for (versioned ciphertext) but the re-encryption migration script itself isn't included.
- No rate limiting on login — pair with the API-gateway patterns from project #20 in this portfolio.
- Audit log immutability relies on the app layer; production would add DB-level `REVOKE UPDATE, DELETE` and WORM storage for exports.
