# CLAUDE.md

Dental Clinic Management System (PMS) — **multi-tenant SaaS** (Aatmam is the
vendor; each clinic is a tenant). A laptop install still works: the seed
creates one default clinic, so local-first = a SaaS of one. Cloud migration
(PostgreSQL + S3 + real WhatsApp gateway) remains a config swap, not a
redesign. Spec: `docs/superpowers/specs/2026-08-13-multi-tenancy-design.md`.

## Commands

```powershell
# First-time setup (from repo root)
npm run setup                # installs server+client, db push, seed

# Development (two terminals)
cd server; npm run dev       # NestJS API on :4000 (ts-node --transpile-only)
cd client; npm run dev       # Vite SPA on :5173 (proxies /api and /files → :4000)

# After changing prisma/schema.prisma
cd server; npx prisma db push          # applies + regenerates client

# Seed (idempotent: upserts users/settings/procedures; sample data only when empty)
cd server; npm run db:seed

# Type checks (no test suite — verification is tsc + live API smoke tests)
cd server; npx tsc --noEmit
cd client; npx tsc --noEmit
```

Demo logins: `doctor@clinic.local/doctor123`, `assistant@clinic.local/assistant123`,
`admin@clinic.local/admin123` (all in the seeded "Smile Dental" clinic), and
`super@aatmam.local/super123` (platform). Roles: DOCTOR (full clinical +
settings), ASSISTANT (patients, appointments, billing, stock, expenses),
ADMIN (settings only), SUPER_ADMIN (Aatmam staff — `/platform` clinic console
ONLY, explicitly denied on clinic routes).

## Architecture

```
client/src/
  api.ts                  single HTTP door: token header, 401 → /login, ₹/date formatters
  theme.ts                design tokens: per-section palette, plain-English status labels
  allergyCheck.ts         drug↔allergy cross-check (families) used by the Rx modal
  components/ui.tsx       hand-rolled kit (PageHeader/Card/Badge/Button/Modal/Field/
                          Stat/Empty/Hint/ConfirmDialog) — no MUI/AntD
  components/             Layout (role-gated nav+global search+SectionProvider),
                          DentalChart (odontogram), PlansLab, MedicineEditor
                          (tap-to-dose Rx card), Brand ("Powered by" maker's mark)
  pages/                  one file per route; Print*.tsx are print-styled (window.print → PDF)
server/src/
  core/                   global: PrismaService (tenant-scoping middleware),
                          tenancy.ts (AsyncLocalStorage tenant context),
                          clinic-defaults.ts (new-clinic seed, shared with
                          platform onboarding), TimelineService, AuditService,
                          AuthGuard (APP_GUARD), PrismaExceptionFilter (APP_FILTER), env.ts
  modules/<domain>/       thin controller (+ service when logic is non-trivial)
server/prisma/schema.prisma   single source of truth for the data model
server/storage/           uploads/c<clinicId>/ (served by the auth-checked
                          files controller at /files/<key>) and backups/ (zips)
```

Modules: auth, users, patients, procedures, diagnoses, treatments, appointments
(+ risk.service = no-show scoring), billing, documents, prescriptions, followups,
messaging (+ reminders.scheduler cron), dashboard, reports (incl. pnl/leakage/
referrals), search, settings (+ backup — SUPER_ADMIN-only, whole-DB), tooth-
findings, plans, labworks, inventory, expenses, files (auth-checked serving),
platform (SUPER_ADMIN clinic console). The **reports** module and route are
hidden from the UI (no nav entry, no client route) but the backend endpoints
remain.

## Hard rules & conventions

- **Multi-tenancy is enforced in `core/`, never in feature code.** Every
  tenant model carries `clinicId`; Prisma middleware (`prisma.service.ts`)
  auto-injects it on writes, merges it into reads (`findUnique` → scoped
  `findFirst`), and ownership-checks unique-where update/delete. The context
  comes from AsyncLocalStorage (`core/tenancy.ts`), seeded per-request by the
  AuthGuard. **Deny-by-default: a tenant query with no context throws.**
  Request-less code (crons, public webhooks, bootstrap) must wrap itself in
  `tenancy.runAs(clinicId, fn)` / `runPrivileged(fn)` — and those helpers
  await INSIDE the ALS scope because Prisma promises are lazy. The
  `@default(0)` on clinicId only relaxes create TYPES (middleware injects the
  real value; an actual 0 fails the FK). Per-clinic uniques: patient `code`,
  invoice `number`, procedure/inventory `name`, setting `key` (composite
  `[clinicId, key]` — the middleware rewrites `where: { key }` so call sites
  stay simple; upserts need `as never` on that where). `User.email` stays
  globally unique (login has no clinic picker). Never hand-write `clinicId`
  filters in modules — the only exception is the platform module, which runs
  bypassed and sets it explicitly.

- **SQLite portability (enforced everywhere):** no Prisma enums (String columns
  validated by `const` arrays in services), no `Json` columns (JSON **text**
  parsed at the service boundary), no raw SQL. Postgres migration = provider swap.
- **Auth:** custom guard, no Passport. Deny-by-default via global `AuthGuard`;
  `@Public()` opts out (login, `/messages/inbound`); `@Roles('DOCTOR','ADMIN')`
  on every medical/financial write (handler-level overrides class-level). The
  guard re-checks `user.active` + role in the DB on every request — deactivation
  is instant. JWT_SECRET is auto-generated into `server/.env` on first boot.
- **Roles are `SUPER_ADMIN | ADMIN | DOCTOR | ASSISTANT`** (`ROLES` in
  `core/auth.guard.ts`; clinic staff creation validates against `CLINIC_ROLES`
  so a clinic admin can never mint a SUPER_ADMIN). The guard re-checks the
  clinic's `active` flag too — deactivating a clinic locks out all its users
  on the next request. SUPER_ADMIN is denied on any route that doesn't list it
  in `@Roles`. Nav + patient tabs are gated per role in the client (see the
  role-gating bullet below); the server stays the real enforcer via `@Roles`.
- **Safety guards (July 2026 audit, see `docs/AUDIT-2026-07.md`):**
  prescriptions cross-check the patient's `medicalHistory.allergies` against
  drug families (`client/src/allergyCheck.ts`) and require an explicit ack;
  appointment booking blocks archived patients and warns (never hard-blocks) on
  slot overlap (`GET /appointments/clash`, checked on create *and* reschedule)
  and past dates. Keep these when touching prescriptions or appointments.
- **Every domain write** also appends a `TimelineEvent`
  (`timeline.add(patientId, TYPE, title, …)`) — the patient timeline UI and the
  AI substrate. `AuditService.log()` never throws.
- **Money is always derived**, never stored: outstanding = Σ non-VOID invoice
  totals − Σ payments. Payments validate their invoice (same patient, not VOID);
  invoices with payments cannot be voided. The **patients list** shows per-row
  `outstanding` (`PatientsService.list` computes it for the page's rows in two
  grouped queries — no N+1) and the **Dashboard omits money entirely**: its four
  tiles are operational (appointments today, follow-up calls due, treatments in
  progress, lab cases open) and there is no revenue/collection card or recent-
  replies card.
- **Messaging:** `MessagingService.send()` persists the Message first, then
  webhook POST (`messaging.webhookUrl` setting) or console log. All scheduler
  jobs are idempotent via `alreadySent(kind, refType, refId, sinceDays?)`.
  Inbound webhook optionally guarded by `messaging.inboundToken`.
- **Archived patients** (`Patient.active=false`): every scheduler job and
  outreach list (recall, leakage, risk) must filter `patient: { active: true }`.
  Keep this invariant when adding new automated messaging.
- **Status fields are state machines**: treatments use an explicit transition
  map (terminal states stay terminal); plan accept is an atomic conditional
  `updateMany` (PROPOSED→ACCEPTED) before creating treatments — preserve these
  patterns for new statuses.
- **Human-readable codes** (P-0001) derive from the autoincrement id (create
  with temp code → update), never `count+1`. Invoice numbers retry on P2002.
- **Uploads:** MIME **and** extension allowlist (jpg/jpeg/png/webp/pdf), 25 MB,
  generated filenames; DB stores relative keys only.
- Client state = React Query only (broad `qc.invalidateQueries()` after
  mutations); the sole client-side state is the JWT + user in localStorage.
- **UI role-gating is cosmetic — the server is the enforcer.** Two layers:
  - **Sidebar nav** (`components/Layout.tsx`): each item carries a `roles` array.
    ADMIN → Settings only (and `<Home>` in `App.tsx` redirects ADMIN to
    `/settings`); ASSISTANT → Home, Patients, Appointments, Billing, Stock,
    Expenses; DOCTOR → all of those plus Treatments and Settings.
  - **Patient-record tabs** (`pages/PatientDetail.tsx`): `isClinical()` =
    DOCTOR|ADMIN. `CLINICAL_TABS` (Dental Chart, Clinical, Plans & Lab) and the
    per-row clinical add/edit actions are hidden from the ASSISTANT; the tab list
    is filtered to `visibleTabs`.
- **Design system (`client/src/theme.ts`)**: every nav section owns a colour
  (`SECTIONS`); `Layout` resolves it from the route and publishes it via
  `SectionProvider`, so `PageHeader`/`Card`/`Button`/`Stat` pick it up with no
  props. Tailwind class strings in `SECTIONS` are spelled out in full — never
  interpolate them or the scanner drops them.
- **No raw status codes in the UI.** `statusLabel()` maps `NO_SHOW` →
  "Didn't come", `PROPOSED` → "Waiting for patient", etc; `statusTone()` drives
  badge colour. Add new codes to both maps, not to a page.
- **Every page opens with a `<PageHeader>`** carrying a one-line plain-English
  `subtitle`, and **every empty list uses `<Empty>`** with a `hint` and, where
  one exists, the button that fills it (`celebrate` when empty is good news).
  Destructive actions go through `<ConfirmDialog>`. Long forms put their
  Save/Cancel in `Modal`'s pinned `footer` slot (so it never scrolls away);
  two-column card grids use `items-start` so a short card doesn't stretch to a
  tall neighbour and leave a gap.
- **Maker branding:** `components/Brand.tsx` (`<PoweredByAatmam>`) renders
  "Powered by Aatmam Software Pvt. Ltd." in the sidebar footer and on the login
  screen. It loads the logo from `/aatmam-logo.png` (drop the file in
  `client/public/`; see `client/public/README-LOGO.txt`) and falls back to a text
  wordmark if the file is absent. "Smile Dental" is the *clinic* brand (the
  tenant); Aatmam is the *vendor*.
- **Procedure catalogue** is seeded from the clinic's paper case sheet, grouped
  under the eight "Treatment Adviced" headings (IOPA, Oral Prophylaxis,
  Restorations, RCT, Extractions, Prosthesis, Implants, Miscellaneous) with
  placeholder INR prices. Seeded via upsert-by-name in `prisma/seed.ts` — safe to
  re-run, edit prices under Treatments.
- **Rx library is Settings-backed, not new tables.** Custom prescription
  templates and the medicine formulary live as JSON text in the `Setting` table
  (`prescriptions.templates`, `prescriptions.formulary`), edited via
  `GET/PUT /prescriptions/templates` and `/prescriptions/formulary`. These are
  `@Roles('DOCTOR','ADMIN')` (the dentist curates their own library) — unlike
  `PUT /settings`, which is ADMIN-only. Built-in templates are read-only and
  filtered out on save.

## Gotchas

- Nest DI needs `emitDecoratorMetadata` → dev runs via **ts-node
  --transpile-only** (esbuild/tsx won't work).
- `@nestjs/schedule` v4: use cron strings (`@Cron('*/15 * * * *')`);
  some `CronExpression` members don't exist.
- Prisma create/update with spread `Record<string,unknown>` may need `as never`.
- Git Bash on Windows: `/tmp` and `/c/...` paths break native curl `-F` and
  Windows Python — `cd` into the scratchpad and use relative paths.
- The seed only creates sample patients/inventory when tables are empty —
  safe to re-run to restore demo users/settings.
- Prisma known errors are mapped globally (P2002→409, P2025→404, P2003→400) —
  don't add per-controller try/catch for those.

## Documentation map (keep in sync when adding features)

- `README.md` — overview, quick start, feature list
- `docs/ARCHITECTURE.md` — diagrams, request lifecycle, data model, engines, migration paths
- `docs/DESIGN-DECISIONS.md` — why each choice was made, alternatives, trade-offs
- `docs/USER-GUIDE.md` — per-role workflows, going-live messaging setup, troubleshooting
- `docs/GAP-ANALYSIS.md` — competitor comparison, implemented gaps, deferred items
- `docs/CRITIQUE-AND-FIXES.md` — novel features (risk engine, leakage radar), security loopholes found & fixed
- `docs/AUDIT-2026-07.md` — clinical/financial/UX loopholes found & fixed in the July 2026 critical pass
- `server/RESTORE.md` — manual backup-restore steps (deliberately not an endpoint)
