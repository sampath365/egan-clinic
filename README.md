# EGAN Clinic

A complete but deliberately simple clinic-management application for small
clinics: individual doctors, family practices, dental/physio/outpatient clinics,
and small multi-doctor clinics. It is **not** a hospital ERP.

Primary workflow:

```
Patient → Appointment → Consultation → Prescription → Payment → Follow-up
```

Optional medical-shop workflow (can be switched off entirely):

```
Prescription → Patient + Medical Shop → Pharmacy review → Order
```

## Stack

| Layer | Technology |
| --- | --- |
| API | Node.js, Fastify 5, TypeScript, Zod, JWT |
| Data | Prisma ORM + SQLite (swap the datasource for PostgreSQL in production) |
| Web | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, Recharts |
| Documents | pdf-lib (prescription PDFs), qrcode (verification QR) |

## Repository layout

```
egan-clinic/
├── server/                 Fastify API
│   ├── prisma/
│   │   ├── schema.prisma   ~30 normalized entities
│   │   └── seed.ts         Realistic demo data
│   ├── src/
│   │   ├── modules/        One folder per domain (auth, clinic, patients, ...)
│   │   ├── plugins/        auth (JWT + RBAC), error handler
│   │   └── shared/         config, prisma, permissions, constants, audit, ...
│   └── test/               Vitest suite (real HTTP against the real app)
└── client/                 React web app
    └── src/
        ├── components/ui/  Reusable component library
        ├── contexts/       Auth
        ├── pages/          Route screens (incl. patient portal + pharmacy)
        └── lib/            API client, permissions, formatting
```

## Getting started

```bash
# 1. Install dependencies for both workspaces
npm install

# 2. Create the server environment file
cp server/.env.example server/.env

# 3. Create the database, generate the client, and load demo data
npm run db:push
npm run db:generate
npm run db:seed

# 4. Run API + web app together
npm run dev
```

- Web app: <http://localhost:5173>
- API: <http://localhost:4000> (health check at `/health`)

Or run everything in one step after `npm install`:

```bash
npm run setup
```

## Demo accounts

Password for **all** demo accounts: `Password123!`

| Role | Email |
| --- | --- |
| Clinic owner **and** doctor | `owner@eganclinic.demo` |
| General physician | `dr.kapoor@eganclinic.demo` |
| Pediatrician | `dr.iyer@eganclinic.demo` |
| Receptionist | `reception@eganclinic.demo` |
| Nurse | `nurse@eganclinic.demo` |
| Pharmacist | `pharmacist@eganclinic.demo` |
| Patient | `patient@eganclinic.demo` |

Demo data includes **EGAN Family Clinic** with the medical shop **enabled** and an
attached **EGAN Medical Store**, an eligible external pharmacy, five patients
with family links, today's appointments, a live token queue, and prescriptions in
typed, handwritten (ink), voice-draft, issued and pharmacy-shared states.

## Product modes

| Mode | Configuration | Prescription can go to |
| --- | --- | --- |
| A | Clinic only | Patient |
| B | Clinic + attached medical shop | Patient, attached shop, or both |
| C | Clinic + external EGAN shop | A participating pharmacy, after patient consent |

The medical-shop module is toggled in **Settings → Medical shop**. When disabled,
every pharmacy surface is hidden across the app and the API refuses to share to a
pharmacy.

## Roles and permissions

RBAC is defined once in `server/src/shared/permissions.ts` and mirrored for the UI
in `client/src/lib/permissions.ts`. Roles: `SUPER_ADMIN`, `CLINIC_OWNER`,
`DOCTOR`, `RECEPTIONIST`, `NURSE`, `CLINIC_STAFF`, `PHARMACIST`, `PATIENT`.

Deliberate boundaries:

- A **doctor** never receives pharmacy permissions.
- A **pharmacist** never receives clinical-administration or billing access, and
  can only see prescriptions explicitly shared with their pharmacy.
- A **patient** can only reach their own records (plus family records explicitly
  marked as shared).

Client-side gates are a convenience only — the server re-checks every request.

## Key business rules enforced by the API

1. A doctor must review and explicitly issue a prescription; empty prescriptions
   cannot be issued.
2. Voice input only produces an editable transcript — it never issues anything.
3. Handwritten prescriptions are stored exactly as written and are never
   converted into medicine orders automatically.
4. Issued prescriptions are immutable and versioned. Editing is refused with
   `409`; a **corrected version** is created instead and the original is marked
   `SUPERSEDED` and retained in the audit trail.
5. A pharmacy must independently verify and accept a prescription before
   dispensing. Invalid workflow transitions are rejected.
6. Sharing with an external pharmacy requires recorded patient consent.
7. Pharmacy access is scoped to prescriptions shared with that pharmacy.
8. Patient records and documents are protected by authorization checks and
   audited on access.
9. Pharmacy features are hidden and refused when the module is disabled.
10. No diagnosis or medicine is ever recommended automatically.

## Security

- JWT sessions with a per-user `tokenVersion`, so **logout from all devices**
  invalidates every previously issued token.
- Passwords hashed with bcrypt (cost 12).
- Zod validation on all request input; a global error handler that never leaks
  stack traces.
- Rate limiting on the API, and a tighter limit on login.
- Helmet security headers and a configurable CORS allow-list.
- Uploaded documents are stored outside the web root and served only through an
  authorized, audited download endpoint.
- Audit log covering patient, consultation, prescription, pharmacy, payment,
  permission and consent events.

## API surface

```
/api/auth              login, me, logout, logout-all, change-password
/api/clinics           onboarding, profile, settings, services, staff
/api/doctors           profiles, availability, leave
/api/patients          registration, family, full clinical history
/api/appointments      booking, status, reschedule
/api/queue             tokens, call/skip/recall/complete, position
/api/consultations     notes, vitals, diagnoses, investigations, procedures
/api/follow-ups        scheduling, reminders
/api/prescriptions     create, content, ink, issue, correct, cancel, share,
                       pdf, whatsapp, preview, verify/:no
/api/pharmacies        attached + eligible external shops, users
/api/pharmacy-prescriptions  inbox, review transitions, orders
/api/billing           invoices, payments, refunds
/api/documents         upload, authorized download, delete
/api/notifications     inbox, preferences, announcements
/api/reports           dashboard, patients, appointments, revenue, doctors,
                       prescriptions, follow-ups, pharmacy, cancellations
/api/audit             activity log and per-entity trail
```

## Testing

```bash
npm test
```

The suite boots the real Fastify app and exercises it over HTTP against the
seeded database — no mocks — covering the business rules above plus RBAC
isolation and billing arithmetic.

## Production notes

- Point `DATABASE_URL` at PostgreSQL and change `provider` in `schema.prisma`.
- Set a strong `JWT_SECRET` and real values for `PUBLIC_BASE_URL` and CORS.
- WhatsApp/SMS/email/push are optional. Without provider credentials the app
  falls back to in-app notifications and a device share sheet for WhatsApp.
- Designed so the clinic can later integrate with the wider EGAN ecosystem
  (medical shop, hospital, laboratory, ambulance, home healthcare, delivery,
  payments, notifications) without changing the core architecture.
