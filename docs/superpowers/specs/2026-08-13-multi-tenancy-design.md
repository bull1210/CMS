# Multi-tenancy design — Aatmam multi-clinic SaaS (2026-08-13)

Approved design for converting the single-clinic PMS into a multi-clinic SaaS
product. Sub-project A of three (A: multi-tenancy, B: cloud deployment,
C: WhatsApp integration). Local-first single-clinic mode must keep working:
a laptop install is simply a SaaS of one.

## Decisions

- **Isolation model:** shared database, `clinicId` column on every
  tenant-owned row. DB-per-tenant rejected (operational cost, unnecessary at
  tens–hundreds of clinics).
- **Enforcement:** automatic, at the Prisma layer — NOT hand-written `where`
  clauses. `AuthGuard` stores the caller's `clinicId` in AsyncLocalStorage;
  Prisma middleware (`$use`, available on Prisma 5.x) injects `clinicId` into
  every query on tenant models. Deny-by-default: a tenant-model query with no
  tenant context **throws** instead of returning cross-tenant data.
- **`User.email` stays globally unique** so login remains email+password with
  no clinic picker; the clinic rides in the JWT. Trade-off: one email cannot
  work at two clinics (acceptable; revisit if needed).
- **`SUPER_ADMIN`** (Aatmam staff) = `User` with `clinicId = null`. May call
  only `/platform/*` endpoints; explicitly denied on clinic routes (no
  silent backdoor into clinic data).
- **Billing/subscriptions deferred.** `Clinic.plan` is a string placeholder.
  Clinic creation is manual via platform console (no self-serve signup yet).

## Schema

- New `Clinic` model: `id, name, slug @unique, phone?, address?, active,
  plan ("TRIAL"), createdAt` + relations.
- `clinicId Int` (+ relation) added to every tenant model: User (nullable —
  SUPER_ADMIN), Patient, Procedure, Treatment, Diagnosis, Appointment,
  ToothFinding, TreatmentPlan, LabWork, InventoryItem, StockTxn, Expense,
  Invoice, Payment, Document, Prescription, FollowUp, Message, TimelineEvent,
  AuditLog (nullable — platform events), Setting.
  `InvoiceItem`/`TreatmentPlanItem` excluded: only reachable via parent,
  cascade-deleted with it.
- Unique constraints become per-clinic: `[clinicId, code]` (Patient),
  `[clinicId, number]` (Invoice), `[clinicId, name]` (Procedure,
  InventoryItem), `[clinicId, key]` (Setting — new autoincrement id PK).
- Hot indexes become composite: `[clinicId, startsAt]` (Appointment),
  `[clinicId, dueDate]` (FollowUp), `[clinicId, name]`/`[clinicId, phone]`
  (Patient), etc.
- Patient codes switch from id-derived to per-clinic sequence with
  P2002-retry (the sanctioned invoice-number pattern) so every clinic starts
  at P-0001 and codes don't leak cross-tenant volume.
- Dev DB is reset + reseeded (demo data only; no production data exists).

## Tenancy core (`server/src/core/tenancy.ts`)

- `TenancyContext`: AsyncLocalStorage wrapper. Store `{ clinicId?, bypass? }`
  is created empty by an Express-level middleware for every request and
  mutated later by the guard (ALS store is by-reference). API:
  `runAs(clinicId, fn)`, `runPrivileged(fn)`, `set(patch)`, `get()`.
- Prisma middleware on `PrismaService` (call sites unchanged):
  - Tenant models discovered from DMMF (`has clinicId field`) — new models
    are covered automatically.
  - `create`/`createMany`: inject `data.clinicId`.
  - `find*/count/aggregate/groupBy/updateMany/deleteMany`: merge `clinicId`
    into `where`. `findUnique(OrThrow)` rewritten to `findFirst(OrThrow)`.
  - `update`/`delete` (unique where): ownership pre-check (`findFirst` with
    scope), throw P2025 if not owned — global filter maps it to 404.
  - `Setting` special-case: `findUnique({where:{key}})` →
    `findFirst({where:{key, clinicId}})`; `upsert({where:{key}})` → composite
    `clinicId_key` + injected `create.clinicId`. Keeps ~30 settings call
    sites unchanged.
  - `bypass: true` (SUPER_ADMIN / privileged blocks) skips scoping.
  - No context and no bypass → throw.

## Auth

- JWT payload gains `clinicId` (null for SUPER_ADMIN).
- `AuthGuard` per-request re-check (existing pattern) additionally loads the
  user's clinic and rejects when `clinic.active = false` — instant lockout of
  a suspended clinic. Then seeds the ALS store.
- `ROLES` gains `SUPER_ADMIN`. Guard denies SUPER_ADMIN on any route whose
  roles don't explicitly include it; platform controller is
  `@Roles('SUPER_ADMIN')`.
- `AuthService.login` wraps its user lookup in `runPrivileged` (no tenant
  context exists before authentication).

## Request-less code paths

- **Schedulers** (reminders cron): outer loop lists active clinics
  (privileged), runs the existing per-clinic job inside `runAs(clinic.id)`.
  All idempotency and archived-patient invariants unchanged.
- **Inbound webhook** (`/messages/inbound`, public): finds the matching
  outbound message privileged, then processes inside
  `runAs(message.clinicId)`.
- **Seed**: standalone script, manages `clinicId` explicitly (its raw
  PrismaClient has no middleware).

## Seed & onboarding

- `prisma/clinic-defaults.ts` exports `seedClinicDefaults(prisma, clinicId)`
  (procedure catalogue + default settings), shared by the dev seed and the
  platform module.
- Dev seed: default clinic (`smile-dental`), demo users under it, sample data,
  plus SUPER_ADMIN `super@aatmam.local / super123`.
- `POST /platform/clinics` creates clinic + defaults + first ADMIN user in
  one transaction-ish flow.

## Files become private

- Uploads stored under `c<clinicId>/<generated-name>`; DB keeps the relative
  key (existing rule).
- Static `/files` serving replaced by an authenticated controller that
  validates the JWT (Authorization header, or `?token=` for `<img>` tags) and
  requires the path's `c<clinicId>/` prefix to match the caller's clinic.
- Client gets a `fileUrl(key)` helper that appends the token.

## Platform console

- Server: `platform` module — `GET/POST /platform/clinics`,
  `PUT /platform/clinics/:id` (rename, activate/deactivate, plan).
- Client: `/platform` page (SUPER_ADMIN only): clinic list, create form,
  activate/deactivate. Nav shows only Platform for SUPER_ADMIN; `<Home>`
  redirects SUPER_ADMIN there. Deliberately minimal.
- Whole-DB backup endpoint moves to platform scope; per-clinic export is a
  future feature.

## Acceptance

- `tsc --noEmit` clean on server and client.
- Live test with two seeded clinics: clinic A's login cannot read clinic B's
  patients, settings, appointments, or files; platform endpoints reject
  clinic users; clinic routes reject SUPER_ADMIN; deactivating a clinic
  locks out its users on the next request.

## Explicitly unchanged

Derived money, timeline events, audit logging, status state machines,
status label maps, role gating, SQLite portability rules (no enums, no Json
columns, no raw SQL), React Query invalidation pattern.
