# Design Decisions

Why the system is built the way it is — each decision, the alternatives that
were considered, and the trade-offs accepted.

---

## 1. Stack: NestJS over Spring Boot

The requirements allowed either. NestJS was chosen because:

- **One language end to end.** TypeScript on both client and server means shared
  mental models, no context switching, and a future option to share types.
- **Lighter local footprint.** A dentist's laptop runs `node` comfortably; a JVM
  plus Spring adds memory pressure and slower startup for zero functional gain
  at this scale (50–1000 patients).
- **Faster iteration.** Prisma + ts-node dev loop restarts in ~2 seconds.

Trade-off: Spring Boot has stronger enterprise conventions (bean validation,
transactions). At clinic scale these are not the bottleneck, and NestJS's module
system provides the same clean-architecture boundaries.

## 2. SQLite first, PostgreSQL later — via Prisma

- SQLite gives **zero-install persistence**: the whole database is one file
  (`server/prisma/clinic.db`), trivially backed up by copying, comfortably fast
  for 1000 patients (all queries are millisecond-range with the indexes defined).
- Prisma is the **migration insurance**: no raw SQL exists anywhere in the
  codebase, so moving to PostgreSQL/MySQL is a one-line `provider` change plus
  `prisma migrate`.

Two SQLite limitations shaped the schema, deliberately in a portable way:

| Limitation | Decision | Portability |
|---|---|---|
| No native enums | Status/role/category columns are `String` validated by constants in code | Works identically on Postgres; can tighten to DB enums later |
| No `Json` column type | Flexible data (medical history, prescription content) stored as JSON **text**, parsed at the service boundary | Postgres migration can switch to `jsonb` without touching callers |

Storing medical history as JSON (rather than 10 boolean columns) also satisfies
the "custom fields allowed" requirement without schema churn.

## 3. Append-only `TimelineEvent` stream instead of deriving the timeline

The patient timeline could have been computed by unioning eight tables at read
time. Instead, every service **writes an event** (`TimelineService.add`) when
something happens.

- Reads are one indexed query (`patientId, createdAt`) — the "complete history
  in one screen in under 2 seconds" success criterion is trivially met.
- The stream is the **AI substrate**: clinical summaries, recall campaigns, and
  treatment suggestions all want "everything that happened to this patient,
  in order, as text" — which is exactly what this table is.
- Events survive even if a source row is later voided/edited, which is the
  correct audit posture for medical records.

Trade-off: minor write duplication (an invoice row *and* an invoice event). This
is accepted; events are small and immutable.

## 4. Treatment flow encoded on the procedure catalog

The recommendation engine ("Root Canal Stage 1 → Stage 2 after 14 days") is a
**self-relation on `Procedure`** (`followUpId`, `followUpDays`), not a separate
rules engine.

- The doctor edits the flow in the same screen where procedures are priced.
- The engine itself is ~40 lines (`treatments.service.ts → onCompleted`):
  on completion, create a `FollowUp` due after the interval and send the patient
  a recommendation message. Simple enough to never break, expressive enough for
  chains of any length (RCT1 → RCT2 → Crown).

Alternative considered: a generic workflow/rules table. Rejected as YAGNI — a
linear "recommended next" covers the stated clinical flows; a future AI layer is
the right place for smarter suggestions, reading the same data.

## 5. Custom JWT guard, no Passport

Auth is a single `AuthGuard` (~50 lines) registered globally via `APP_GUARD`:
verify Bearer token → attach `req.user` → check `@Roles(...)` metadata.
`@Public()` opts endpoints out (login, inbound-message webhook).

- Passport's strategy abstraction buys nothing when there is exactly one
  strategy (local JWT) — it would triple the auth surface area.
- **Deny-by-default**: every route requires auth unless explicitly `@Public()`,
  so forgetting a decorator fails safe.
- Role semantics implement the spec directly: receptionists can register
  patients, schedule, and collect payments, but every medical-record mutation
  (diagnoses, treatments, prescriptions, uploads, procedure catalog) is
  `@Roles('DOCTOR','ADMIN')` — enforced server-side, merely *hidden* client-side.

Session timeout = JWT expiry (12h), per the security requirement.

## 6. Provider-abstracted messaging with a console fallback

`MessagingService.send()` always **persists the message first**, then
dispatches:

- If `messaging.webhookUrl` is configured → HTTP POST `{channel, to, body}` to
  any gateway (WhatsApp Cloud API relay, Twilio function, MSG91, …).
- If not → the **console provider** logs the message and marks it SENT.

This means the entire product — reminders, questionnaires, recommendations,
reply handling — is fully functional and demoable **offline with zero
accounts**, and going live is a settings change, not a deploy. Inbound replies
have two paths for the same reason: a public `/api/messages/inbound` webhook for
real gateways, and a "record reply" button in the UI for clinics that read
WhatsApp manually.

Reminder scheduling is **idempotent by construction**: each reminder kind is
deduplicated against the message log (`kind + refType + refId`), so the cron can
run every 15 minutes (or be triggered manually) without double-sending.

## 7. Print-to-PDF instead of server-side PDF generation

Invoices, receipts, and prescriptions are **print-styled HTML routes**
(`/print/invoice/:id`, `/print/prescription/:id`) using `window.print()`.

- Every OS turns print into "Save as PDF" natively — zero dependencies, and the
  layout is ordinary Tailwind, so changing the letterhead is a JSX edit rather
  than fighting a PDF library's coordinate system.
- `pdfkit`/`puppeteer` were rejected: heavyweight (puppeteer bundles Chromium),
  and the output is harder to iterate on than HTML.

Trade-off: PDFs aren't generated server-side for archival. If needed later, the
same HTML routes can be rendered headlessly.

## 8. Backup = one zip of DB + attachments

A backup must be something a non-technical clinic owner can trust and restore.
Decision: a single zip containing `clinic.db` and the whole `uploads/` folder,
created nightly at 01:30 and on demand, downloadable from Settings.

- Restore is documented as three steps (stop server, unzip, start) in
  `server/RESTORE.md` rather than implemented as an endpoint — overwriting a
  **live, open** SQLite file on Windows is unreliable, and a wrong-button
  in-app restore is the most destructive action the product could have.

## 9. Storage keys, not paths

`Document.storedPath` holds a **relative key** (`1784308159324-936011854.png`),
never an absolute path. Files are served under `/files/<key>`. Migrating to
S3/Azure Blob therefore swaps the read/write adapter and leaves the database
and UI untouched.

Upload safety: MIME allowlist (JPG/PNG/WEBP/PDF), 25 MB cap, generated
filenames (no user input in paths), traversal-safe download endpoints.

## 10. React Query + small hand-rolled UI kit, no component library

- **React Query** replaces a global store entirely: server state is cached by
  key, and any mutation invalidates broadly (`qc.invalidateQueries()`), which at
  clinic scale is simpler and less bug-prone than fine-grained cache surgery.
- **No MUI/AntD**: the UI kit is ~120 lines (`ui.tsx` — Card, Badge, Button,
  Modal, Field, Stat). A component library would dominate bundle size and fight
  the "feels as simple as WhatsApp" goal; Tailwind utilities keep every screen
  visually consistent by construction.

## 11. Search is `LIKE`, on purpose

Global search hits four indexed columns with `contains` across three entities,
capped at 10/5/5 results. At ≤1000 patients this returns in single-digit
milliseconds — full-text search engines (FTS5, Meilisearch) would add moving
parts for no perceptible gain. The search endpoint is isolated (`search/`
module) so an FTS backend can replace its internals if the clinic grows 100×.

## 12. Fully derived money, no stored balances

Outstanding amounts are **never stored** — they are always
`sum(invoices) − sum(payments)`, computed per patient and clinic-wide.
Stored balances drift; derived balances cannot. Invoice status (OPEN → PARTIAL
→ PAID) is refreshed from payments after every payment write, and VOID invoices
are excluded everywhere. Rounding uses explicit `Math.round(x*100)/100` at tax
calculation, the single place where fractions appear.

## 13. Audit log that never blocks the business action

`AuditService.log()` swallows its own failures (`.catch(() => undefined)`).
A clinic must never fail to record a payment because the audit insert failed;
auditing is a witness, not a gatekeeper.

## 14. No-show risk = explainable heuristics, not a model

The risk engine (`appointments/risk.service.ts`) scores appointments with
hand-weighted factors (past no-shows, unconfirmed, unanswered reminders, first
visit, long lead time) instead of a trained classifier.

- The front desk must know **why** a patient is flagged — every score ships
  with its reasons in plain words, which no black-box model gives for free.
- At clinic scale there is no training data to learn from anyway; the
  heuristics encode what the literature and dentists already know.
- The scoring function consumes exactly the features a future model would, so
  upgrading later is a one-method swap.

## 15. Leakage and P&L are computed live, never stored

The revenue leakage radar and profit & loss reports are pure queries over
invoices, payments, treatments, follow-ups and expenses. Stored aggregates
drift (see decision 12); derived ones are always right, and at ≤1000 patients
every leakage query is milliseconds. Trade-off: the "unbilled treatment" check
relies on the invoice↔treatment link, so a manually typed invoice without the
link over-reports leakage — the safe direction for a money-warning report.

## 16. Patients are archived, never deleted

There is deliberately no delete for patients. `Patient.active = false` (with a
reason) stops every automated message and removes them from outreach lists,
while the chart, billing and documents remain. Medical records must survive;
and the alternative — deletion — would also break derived money and referential
history. The one invariant every new scheduler job must keep: filter
`patient: { active: true }`.

## 17. Security hardening favors simple, local mechanisms

- **Live user check in the guard** (one indexed lookup per request) instead of
  token blacklists/refresh-token infrastructure — at LAN scale the lookup is
  free and deactivation must be instant.
- **In-memory login throttle** (5 fails → 15 min) instead of persisted
  counters — a restart clearing it is acceptable for a single-process local
  server; the audit log keeps the durable record.
- **Shared-token webhook auth** (`messaging.inboundToken`) instead of HMAC
  signatures — every SMS gateway can send a static header/query token, few can
  sign payloads; empty token keeps offline demos working.
- **Auto-generated JWT secret persisted to `.env`** instead of failing the
  boot — a non-technical clinic will never set an env var; silent-weak
  (`dev-secret`) was the loophole, silent-strong is the fix.
