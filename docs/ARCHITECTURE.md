# Architecture

Technical map of the system: components, request flow, data model, and the
paths to cloud and AI.

---

## 1. Bird's-eye view

```
┌─────────────────────────────  Laptop / LAN  ─────────────────────────────┐
│                                                                          │
│  Browser (any device on LAN)                                             │
│  ┌────────────────────────────┐                                          │
│  │  React SPA  (Vite :5173)   │  React Query cache · JWT in localStorage │
│  └──────────┬─────────────────┘                                          │
│             │  /api/* and /files/*  (Vite dev proxy)                     │
│  ┌──────────▼─────────────────────────────────────────────┐              │
│  │  NestJS API  (:4000)                                   │              │
│  │                                                        │              │
│  │  Global: AuthGuard (JWT + roles + live user check)     │              │
│  │          PrismaExceptionFilter (P2002→409 …)           │              │
│  │  ┌──────────── domain modules ─────────────┐           │              │
│  │  │ auth users patients procedures          │           │              │
│  │  │ diagnoses treatments appointments(+risk)│           │              │
│  │  │ billing documents prescriptions         │           │              │
│  │  │ followups messaging dashboard reports   │           │              │
│  │  │ search settings(+backup) tooth-findings │           │              │
│  │  │ plans labworks inventory expenses       │           │              │
│  │  └───────┬─────────────────────────────────┘           │              │
│  │  Core (global providers):                              │              │
│  │    PrismaService · TimelineService · AuditService      │              │
│  │  Cron: reminders/recall/birthday/risk (15 min)         │              │
│  │        nightly backup (01:30)                          │              │
│  └───────┬──────────────────────────┬─────────────────────┘              │
│          │ Prisma                   │ fs                                 │
│  ┌───────▼────────┐   ┌─────────────▼──────────────┐                     │
│  │ SQLite         │   │ storage/uploads  (files)   │                     │
│  │ prisma/        │   │ storage/backups  (zips)    │                     │
│  │   clinic.db    │   └────────────────────────────┘                     │
│  └────────────────┘                                                      │
│                                                                          │
│  Optional outbound: messaging.webhookUrl ──► WhatsApp/SMS gateway        │
│  Optional inbound:  POST /api/messages/inbound ◄── gateway webhook       │
└──────────────────────────────────────────────────────────────────────────┘
```

Two processes, one database file, one uploads folder. Nothing else to operate.

## 2. Repository layout

```
CMS/
├─ client/                       # React SPA
│  ├─ vite.config.ts             # dev proxy: /api, /files → :4000
│  └─ src/
│     ├─ api.ts                  # fetch wrapper: token header, 401 → login, formatters
│     ├─ App.tsx                 # routes + RequireAuth
│     ├─ theme.ts                # design tokens: per-section palette (SECTIONS),
│     │                          #   plain-English statusLabel()/statusTone()
│     ├─ allergyCheck.ts         # drug ↔ allergy cross-check (families) for Rx
│     ├─ components/
│     │  ├─ Layout.tsx           # sidebar nav + global search + SectionProvider
│     │  ├─ ui.tsx               # PageHeader/Card/Badge/Button/Modal/ConfirmDialog/
│     │  │                       #   Field/Stat/Empty/Hint primitives (section-themed)
│     │  ├─ MedicineEditor.tsx   # tap-to-dose medicine card (1-0-1 hidden behind chips)
│     │  ├─ DentalChart.tsx      # interactive FDI odontogram
│     │  └─ PlansLab.tsx         # treatment plans + lab work tab
│     └─ pages/                  # Dashboard, Patients, PatientDetail, Appointments,
│                                # ProceduresPage, Billing, Inventory, Expenses,
│                                # Reports, Settings, Login, PrintInvoice,
│                                # PrintPrescription, PrintEstimate, PrintConsent
└─ server/
   ├─ prisma/
   │  ├─ schema.prisma           # the single source of truth for the data model
   │  └─ seed.ts                 # demo users, procedure flows, sample patients
   ├─ storage/{uploads,backups}  # created on demand
   └─ src/
      ├─ main.ts                 # bootstrap, /api prefix, /files static, CORS
      ├─ app.module.ts           # module registry + global JwtModule + APP_GUARD
      ├─ core/
      │  ├─ env.ts               # dependency-free .env loader + JWT_SECRET bootstrap
      │  ├─ auth.guard.ts        # JWT verify + live active/role check + @Roles/@Public
      │  ├─ prisma-exception.filter.ts  # P2002→409, P2025→404, P2003→400
      │  ├─ prisma.service.ts
      │  ├─ timeline.service.ts  # append-only patient event stream
      │  └─ audit.service.ts     # who did what (incl. LOGIN_FAILED), never throws
      └─ modules/<domain>/       # controller (+ service where logic is non-trivial)
```

**Module convention:** thin controllers own HTTP/validation/RBAC; services own
business logic; Prisma is the only persistence API. Modules do not import each
other's internals — the one deliberate coupling is `TreatmentsModule →
MessagingService` (completing a treatment sends a recommendation), expressed via
Nest module exports.

### 2.1 Frontend design system

The UI is built to be usable by a non-technical dentist, and its look is driven
by tokens rather than per-page styling (`client/src/theme.ts`):

- **Section colour.** Each nav area owns a colour (`SECTIONS`): Patients blue,
  Appointments violet, Billing green, Stock amber, Expenses rose, Reports teal,
  Settings slate. `Layout` resolves the colour from the current route and
  publishes it via `SectionProvider`, so `PageHeader`, `Card`, `Button`, `Stat`
  and `Modal` pick it up with **no props**. Colour answers "where am I" without
  reading a word. Tailwind class strings in `SECTIONS` are spelled out in full —
  never interpolated — so the JIT scanner keeps them.
- **No raw status codes reach the screen.** `statusLabel()` maps database values
  to plain English (`NO_SHOW` → "Didn't come", `PROPOSED` → "Waiting for
  patient"); `statusTone()` maps them to badge colour. Add a new code to both
  maps, never to a page.
- **Guided-usability conventions** (enforced by the shared kit): every page opens
  with a `<PageHeader>` carrying a one-line plain-English subtitle; every empty
  list uses `<Empty>` with a `hint` and, where one exists, the button that fills
  it (`celebrate` when empty is good news); destructive actions go through
  `<ConfirmDialog>`; `Modal` has a pinned `footer` slot so a long form never
  pushes Save off-screen.
- **Clinical safety at the point of care.** Prescribing cross-checks the
  patient's recorded allergies against drug families (`allergyCheck.ts`) and
  disables Save until an override is ticked. Dosing is entered by tapping
  morning/afternoon/night chips (`MedicineEditor.tsx`); the `1-0-1` shorthand is
  generated for print, never typed.

## 3. Request lifecycle

Every request passes through the same pipeline:

```
HTTP ──► global AuthGuard ──► controller ──► service ──► Prisma ──► SQLite
              │                                  │
              │ @Public? skip                    ├─► TimelineService.add(...)
              │ verify JWT → req.user            └─► AuditService.log(...)
              │ @Roles? check role
              ▼
        401 / 403 on failure
```

- **Deny by default**: the guard runs on every route; only `@Public()` (login,
  inbound webhook — itself guarded by an optional shared token) skips it.
- **Tokens die with their user**: after JWT verification the guard re-reads the
  user row — deactivation or a role change takes effect on the next request,
  not at token expiry.
- **RBAC at the handler**: `@Roles('DOCTOR','ADMIN')` guards every
  medical-record mutation; receptionists hit 403 server-side regardless of UI.
- **Side-band writes**: services append to the timeline and audit log; neither
  can fail the main transaction.
- **Known DB errors are mapped** by a global filter (unique → 409, not found →
  404, broken FK → 400) so staff see actionable messages, never blank 500s.

## 4. Data model (Prisma schema)

```
User ─┬────────────< Treatment >──────────── Procedure ──┐ followUpId
      ├────────────< Diagnosis                  ▲        │ (self-relation
      ├────────────< Appointment                └────────┘  = treatment flow)
      ├────────────< Document
      └────────────< Prescription

Patient ─┬──< Appointment          Invoice ──< InvoiceItem
         ├──< Diagnosis            Invoice ──< Payment
         ├──< Treatment ──< FollowUp (sourceTreatment)
         ├──< Invoice              FollowUp >── Procedure (recommended)
         ├──< Payment
         ├──< Document             Message.refType/refId ──► Appointment|FollowUp|Patient
         ├──< Prescription         (drives reply handling + dedupe)
         ├──< FollowUp
         ├──< Message              TreatmentPlan ──< TreatmentPlanItem >── Procedure
         ├──< ToothFinding         LabWork >── Treatment (optional)
         ├──< TreatmentPlan        InventoryItem ──< StockTxn
         ├──< LabWork              Expense (category, amount, method)
         └──< TimelineEvent        Setting (key/value) · AuditLog
```

Key relationships:

- **`Procedure.followUpId` + `followUpDays`** — the treatment-flow graph. A
  linear chain per procedure, arbitrary depth (RCT1 → RCT2 → Crown).
- **`FollowUp`** — materialized recommendation: who, what procedure, due when,
  `PENDING → BOOKED → DONE / DISMISSED`. Created by the engine on treatment
  completion or manually by the doctor.
- **`Message.refType/refId`** — what a message is *about*. Enables (a) reply
  interpretation (YES on an APPOINTMENT questionnaire → confirm that
  appointment) and (b) idempotent reminders (never send the same kind twice for
  the same ref).
- **`TimelineEvent`** — append-only `(patientId, type, title, detail, ref)`;
  indexed by `(patientId, createdAt)`.
- **`ToothFinding`** — the odontogram: per-tooth conditions in FDI notation,
  ACTIVE until resolved (history never deleted).
- **`TreatmentPlan` + items** — phased estimate; the atomic PROPOSED→ACCEPTED
  transition materializes items as PLANNED treatments exactly once.
- **`Patient.active`** — archiving: false stops every automated message and
  outreach list while keeping the record. All scheduler/outreach queries filter
  on it.
- **Money is derived**: outstanding = Σ non-void invoice totals − Σ payments,
  computed in `patients.summary`, `billing.outstanding`, and the dashboard —
  never stored. Payments validate their invoice (same patient, not VOID);
  invoices with payments cannot be voided.

SQLite portability rules (enforced across the codebase): no enums (string
constants validated in services), no Json columns (JSON text parsed at the
service boundary), no raw SQL.

## 5. The engines

### Follow-up / recommendation engine
`treatments.service.ts → onCompleted(treatmentId)`:

```
treatment COMPLETED
  └─ procedure.followUp defined?
       ├─ no  → done
       └─ yes → guard: no PENDING/BOOKED follow-up for this treatment already
                create FollowUp(due = now + followUpDays)
                timeline event "Follow-up recommended: X"
                MessagingService.send(RECOMMENDATION → patient WhatsApp/SMS)
```

Surfaces: dashboard "Follow-ups due", patient-chart amber strip ("book now"
creates the appointment and flips the follow-up to BOOKED).

### Reminder scheduler
`reminders.scheduler.ts`, cron `*/15 * * * *` plus a manual trigger endpoint:

1. **Appointment reminders** — for each SCHEDULED/CONFIRMED appointment within
   the largest configured offset, send one message per elapsed offset
   (`REMINDER_3D`, `REMINDER_1D`, `REMINDER_2H`…), deduped via the message log.
2. **Questionnaires** — appointments within 24h get one
   "Will you attend?" (kind `QUESTIONNAIRE`).
3. **Follow-up nudges** — PENDING follow-ups due within 3 days (or overdue) get
   at most one nudge per 7 days.
4. **Recall campaign** — patients whose last completed visit is older than
   `recall.months` with nothing booked and no pending follow-up, max one
   message per 60 days (kind `RECALL`).
5. **Birthday greetings** — once per patient per year (kind `BIRTHDAY`,
   toggle `greetings.birthday`).
6. **High-risk confirmations** — appointments the risk engine scores HIGH
   within 24h get one extra personal confirmation request (`RISK_CONFIRM`).

Every job filters `patient: { active: true }` — archived patients are never
messaged.

### No-show risk engine
`appointments/risk.service.ts` scores upcoming appointments (0–100, with
human-readable factors): past no-shows, unconfirmed status, unanswered
reminders, first visit, long booking lead time. Consumed by
`GET /appointments/risk` (dashboard "at-risk" card) and scheduler job 6.
Deliberately explainable heuristics; the feature set is what a learned model
would consume later.

### Revenue leakage radar
`GET /reports/leakage` unifies four "money on the table" queries — completed
treatments never invoiced, unpaid invoices > 14 days, PLANNED treatments whose
patient has nothing booked, and follow-ups > 7 days overdue — each with patient
contact details and a ₹ total. Derived live, never stored.

### Messaging pipeline

```
send() → persist Message(QUEUED)
       → webhookUrl set?  POST {channel,to,body}  → SENT/FAILED
         else             console log             → SENT
       → timeline event

inbound reply (webhook or UI button)
       → store response on the Message
       → refType APPOINTMENT?  YES/1 → CONFIRMED · NO/3 → CANCELLED
                               RESCHEDULE/2 → note for front desk
       → timeline event
```

## 6. Files, backup, security

- **Uploads**: multer → disk with generated names; DB stores the relative key;
  served read-only at `/files/<key>`. MIME **and** extension allowlist +
  25 MB cap.
- **Backup**: archiver zips `clinic.db` + `uploads/` → `storage/backups/`,
  nightly and on demand; download endpoint is traversal-safe (`basename`).
  Restore = stop, unzip, start (`server/RESTORE.md`).
- **Security posture**: bcrypt(10) passwords; 12h JWTs signed with an
  auto-generated 256-bit secret (persisted to `.env` on first boot);
  deny-by-default guard with a live user check (deactivation is instant);
  login lockout after 5 failures per email (15 min) with `LOGIN_FAILED` audit
  rows; optional shared token on the inbound webhook; server-side RBAC; audit
  log on every mutation; parameterized queries via Prisma (no injection
  surface); uploads never executed, only streamed.

## 7. Frontend architecture

- **Server state = React Query** keyed by resource
  (`['patient', id]`, `['appointments', from, to]`…); mutations invalidate
  broadly. No Redux/global store — the only client state is the JWT + user in
  localStorage.
- **`api.ts`** is the single HTTP door: attaches the token, normalizes errors,
  redirects to `/login` on 401.
- **Role-aware UI**: components read the stored role to hide doctor-only
  actions; the server remains the actual enforcer.
- **Print routes** (`/print/...`) render letterhead documents outside the app
  shell; `.no-print` CSS strips chrome, `window.print()` → save as PDF.

## 8. Migration paths (designed-in, not aspirational)

| Move | What changes | What doesn't |
|---|---|---|
| SQLite → PostgreSQL | `provider` in schema.prisma, `DATABASE_URL`, run `prisma migrate` | Every query, service, and screen |
| Local disk → S3/Azure | Swap multer disk storage + `/files` static for an adapter | `Document` rows (relative keys), UI |
| Console → real WhatsApp/SMS | Set `messaging.webhookUrl` in Settings; point gateway webhook at `/api/messages/inbound` | Message log, scheduler, reply logic |
| Single laptop → cloud | Host API + built SPA behind nginx; same two processes | Auth, modules, data model |
| Multi-clinic SaaS | Add `clinicId` FK to Patient/User/Setting and scope queries | Module boundaries, UI |

## 9. AI layer (future) — what it will consume

The AI requirements shaped three structures that already exist:

- **`TimelineEvent`** — ordered, typed, per-patient history → clinical
  summaries ("summarize this patient") are a prompt over one query.
- **`Message` log with replies** — training/ground truth for outreach and an
  actuation channel for AI-generated campaigns.
- **`/api/reports/recall`** — already computes the "inactive 6 months /
  pending treatment / outstanding dues" cohorts; an AI recall system ranks and
  drafts messages for exactly this list.

An `ai/` module would sit beside the existing modules, read through the same
services, and act through MessagingService — no schema changes required.
