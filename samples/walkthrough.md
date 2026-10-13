# Role-by-role walkthrough (after `npm run setup`)

All seeded accounts share the password printed by setup. The tour works best in this order — each role sees the same data differently.

## 1. Receptionist — `frontdesk@clinic.test`

1. **Patients tab** → national ids are **masked** (`*********3456`) — the server masks after decrypting; the full value never reaches this session.
2. Open a chart → you see visit dates and doctors, but **no note bodies** — they're never decrypted for this role (check the network response: `note` is empty).
3. **Register a patient** — the national id is encrypted before insert.
4. **Book an appointment** for Dr. Rahman at a time he already has one → **409 naming the conflicting patient**. Book a free slot instead, then **Check in** someone.
5. Try setting a visit to *completed* — the buttons aren't there, and the API would return 403: clinical outcomes belong to doctors.

## 2. Doctor — `dr.rahman@clinic.test`

1. **Appointments tab** shows **only Dr. Rahman's schedule** (filtered in SQL, not the client). Complete the checked-in visit.
2. **Patients tab** → full national ids (this bulk decrypt just wrote an audit row — you'll see it in step 3).
3. Open Abdullah Al Mamun's chart → decrypted hypertension notes. **Add a record** — it's encrypted before it reaches Postgres, and there is no edit/delete: corrections are new records.
4. Sign in as `dr.chen@clinic.test` in another window — different schedule, same rules.

## 3. Admin — `admin@clinic.test`

1. **Patients tab** → no national id column values, **no “Open chart” button** — and hitting `/api/patients/1` directly returns 403. Admins run the system; they don't treat patients.
2. **Staff tab** → create a new receptionist (password min 10 chars; duplicate email → 409).
3. **Audit log tab** — the centerpiece. Filter by:
   - `record.*` → every chart open and note write, with doctor names
   - `patient.*` → the bulk national-id decrypts from step 2 of the doctor tour
   - `auth.*` → logins, including any failed attempts
   - `audit.*` → **your own views of this log** — watchers are watched
4. Note what admin *cannot* do: no booking outcomes, no charts, no note bodies. That asymmetry is the RBAC story in one screen.

## 4. One curl for the skeptic

```bash
# No session cookie → 401; with a receptionist session on a chart with notes,
# the JSON's note fields are empty strings — RBAC is enforced at decryption,
# not in the UI.
curl -i http://localhost:3000/api/patients/1
```
