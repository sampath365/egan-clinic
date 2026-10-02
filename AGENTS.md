# AGENTS.md — EGAN Clinic

Repository-specific context for AI agents working in this codebase.

## What this is

EGAN Clinic — small-clinic outpatient management (Fastify API + React/TS web app).
Deliberately **not** a hospital ERP. Primary flow:
Patient → Appointment → Consultation → Prescription → Payment → Follow-up.
Optional: Prescription → Patient + Medical Shop → Pharmacy review → Order.

## Layout

- `server/` — Fastify 5 + Prisma (SQLite dev) + Zod. Domain modules live in
  `server/src/modules/<domain>/routes.ts`. Shared infra in `server/src/shared/`
  and `server/src/plugins/`.
- `client/` — React 18 + Vite + Tailwind + TanStack Query. Reusable UI kit in
  `client/src/components/ui/`; screens in `client/src/pages/`.

## Commands

```bash
npm install                 # both workspaces (npm workspaces)
npm run dev                 # API :4000 + web :5173
npm run build               # builds server then client
npm test                    # server Vitest suite (real HTTP, no mocks)
npm run db:push             # apply schema
npm run db:seed             # load demo data
npm run db:reset            # wipe + reseed
```

Server `.env` is required (`cp server/.env.example server/.env`). Config is
loaded via `process.loadEnvFile('.env')` in `server/src/shared/config.ts`.

## Conventions

- ESM with `.js` extensions in TypeScript imports (NodeNext-style).
- One domain module per folder; routes are thin and delegate to shared helpers.
  Never build a single giant controller.
- Validate all request input with Zod via `parseBody` / `parseQuery` /
  `parseParams` in `server/src/shared/validate.ts`.
- Authorization: `app.authenticate` + `requirePermission(...)` on every
  protected route, plus a scope assertion from `server/src/shared/access.ts`
  (`assertPatientAccess`, `assertPrescriptionAccess`, `assertClinicAccess`, ...).
  Never authorize on an id alone.
- Permissions are defined once in `server/src/shared/permissions.ts` and mirrored
  in `client/src/lib/permissions.ts`. Keep the two in sync.
- Status strings live in `server/src/shared/constants.ts` (SQLite has no enums).
  Use the `*_STATUSES` array exports with `z.enum(...)`.
- Audit every sensitive action via `recordAudit`.
- Client-side permission gates are UX only; the server always re-checks.

## Business rules that must not regress

1. A doctor must review and explicitly issue a prescription; empty ones cannot
   be issued (422).
2. Voice input only produces an editable transcript — never auto-issues.
3. Handwriting is stored exactly as written; never auto-converted to medicines.
4. Issued prescriptions are immutable. Editing returns 409; use the corrected
   version flow (original → SUPERSEDED, retained).
5. Pharmacy must verify/accept before dispensing; transitions are enforced by
   `PHARMACY_TRANSITIONS`.
6. External pharmacy sharing requires recorded patient consent.
7. Pharmacy access is scoped to prescriptions shared with that pharmacy.
8. A doctor has **no** pharmacy permissions; a pharmacist has **no** clinical
   administration or billing permissions.
9. When `medicalShopEnabled` is off, hide all pharmacy UI and refuse pharmacy
   sharing (the dashboard returns `medicalShop: null`).
10. Never auto-diagnose or auto-recommend medicines.

## Testing

`npm test` boots the real app and drives it over HTTP against the seeded
database — do not introduce mocks. Tests may mutate demo data; the seed is
idempotent so `npm run db:reset` restores it. Consent is persistent by design,
so consent-related tests must clear prior grants to stay deterministic.

## Gotchas

- SQLite stores `DateTime` as ms-since-epoch; avoid `$queryRaw` date grouping —
  aggregate in application code (see `server/src/modules/reports/routes.ts`).
- Vite dev server needs `server.allowedHosts` for the hosted runtime proxy.
- The generated Prisma client lives in the root `node_modules`.
- `npm run db:push` must run before the server or tests will fail.

## Mobile / responsive conventions

The app is mobile-first; verify changes at 375px and 390px, not just desktop.

- The sidebar is desktop-only (`lg:block`). On phones it collapses into a drawer
  opened from the header hamburger.
- `AppLayout` renders a **bottom tab bar** (`nav[aria-label="Primary"]`) for the
  primary destinations. A nav item appears there only when flagged
  `mobile: true` in `NAV` / `PATIENT_NAV`; everything else is reachable through
  the drawer's **More** button. Keep this list to about four items so tabs do
  not crowd.
- The tab bar is hidden on the prescription editor (`/prescriptions/:id/edit`)
  because that route has its own fixed bottom action bar. If you add another
  fixed bottom bar, extend `hideMobileTabs` in `AppLayout`.
- `main` carries bottom padding (`pb-24 lg:pb-6`) so the fixed bar never covers
  content. Preserve this when changing layout padding.
- `DataTable` renders a real table on `md+` and stacked cards below `md`; do not
  add horizontal-scrolling tables for primary list screens.
- Respect safe areas (`pb-[env(safe-area-inset-bottom)]`) for anything fixed to
  the bottom.
