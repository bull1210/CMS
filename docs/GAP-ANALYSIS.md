# Competitor Gap Analysis

What established dental practice-management products offer that this system did
not, and how each gap was closed. Written after the initial build; every feature
listed as "implemented" below is live in the codebase and verified end-to-end.

---

## 1. Who we compared against

| Product | Market | Why it's a reference |
|---|---|---|
| **Dentrix** (Henry Schein) | US, market leader | Gold standard for charting + treatment planning |
| **Open Dental** | US, open source | Most complete open feature set; lab cases, recall |
| **Eaglesoft** (Patterson) | US | Clinical charting + imaging workflows |
| **Curve Dental / tab32** | US, cloud | Modern cloud UX benchmarks |
| **Carestack** | US/India, cloud | All-in-one: recall automation, inventory, analytics |
| **Practo Ray** | India | The system a small Indian clinic would actually cross-shop: SMS-first, expenses, referral tracking |
| **Dentee / MocDoc** | India | Inventory + lab + accounting for small clinics |

Our system was already strong — often stronger than the incumbents — on:
patient timeline, automated WhatsApp/SMS reminders with reply handling,
follow-up recommendation engine, derived billing, backups, and AI-ready data.
The gaps were the *dental-specific clinical tooling* and *clinic-operations*
features these products treat as core.

## 2. Gap matrix (before this iteration)

| Capability | Dentrix | Open Dental | Carestack | Practo Ray | **Ours (before)** | **Ours (now)** |
|---|---|---|---|---|---|---|
| Interactive tooth chart (odontogram) | ✅ | ✅ | ✅ | ✅ | ❌ free-text tooth numbers only | ✅ |
| Treatment plans / estimates with acceptance | ✅ | ✅ | ✅ | ✅ | ❌ one treatment at a time | ✅ |
| Dental lab case tracking | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| Inventory / stock alerts | ⚠️ add-on | ✅ | ✅ | ✅ | ❌ | ✅ |
| Expense tracking + P&L | ⚠️ | ✅ | ✅ | ✅ | ❌ revenue only | ✅ |
| Automated recall (re-care) campaigns | ✅ | ✅ | ✅ | ✅ | ⚠️ recall *list* only, no outreach | ✅ |
| Birthday greetings | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ✅ |
| Consent forms | ✅ | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| Referral-source tracking | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Insurance claim management (US-style) | ✅ | ✅ | ✅ | n/a | ❌ | ❌ deferred (see §5) |
| Patient portal / online booking | ⚠️ | ⚠️ | ✅ | ✅ | ❌ | ❌ deferred |
| Imaging device integration | ✅ | ✅ | ⚠️ | ❌ | ❌ upload only | ❌ deferred |

## 3. What was missing and how it is now implemented

### 3.1 Interactive dental chart (odontogram)

**Missing:** The defining screen of every dental PMS — a visual mouth map where
the doctor charts per-tooth conditions — didn't exist. Tooth numbers lived only
as free text on treatments (`toothRefs: "16"`), so there was no way to *see*
the state of a mouth at a glance.

**Implemented:**
- New `ToothFinding` model: `(patientId, tooth, condition, status, note)` with
  FDI validation server-side (permanent 11–48, primary 51–85) and a fixed
  condition vocabulary (`CARIES, FILLED, MISSING, CROWN, ROOT_CANAL, IMPLANT,
  FRACTURED, OTHER`). Findings are `ACTIVE` until the doctor resolves them —
  resolution keeps the record (charting history is never deleted).
- New **Dental Chart tab** on the patient page
  (`client/src/components/DentalChart.tsx`): both arches rendered in FDI
  layout with an adult/primary toggle, each tooth color-coded by its most
  significant active condition (priority: missing > implant > root canal >
  crown > fractured > caries > filled), missing teeth crossed out, a legend,
  and a side panel per selected tooth showing findings, treatments performed
  on that tooth (matched from `toothRefs`), and a one-click "chart on tooth N"
  form.
- Charting writes to the patient timeline (`Tooth 16: caries charted`), so the
  odontogram feeds the same AI-ready event stream as everything else.
- RBAC: receptionists can view the chart but every write is `DOCTOR/ADMIN`.

### 3.2 Treatment plans & printable estimates

**Missing:** Competitors let a doctor propose a multi-procedure, multi-phase
plan with a cost estimate, print it, get the patient's signature, and convert
acceptance into scheduled work. We could only create treatments one at a time,
with no estimate document and no accept/decline concept.

**Implemented:**
- New `TreatmentPlan` + `TreatmentPlanItem` models (procedure, tooth, phase,
  cost per item; plan status `PROPOSED → ACCEPTED/CANCELLED → COMPLETED`).
- **Accepting a plan materializes every item as a `PLANNED` treatment** — from
  there the existing engine takes over (start/complete, follow-up
  recommendations, billing). Acceptance is guarded: only a `PROPOSED` plan can
  be accepted, and re-accepting is a no-op, so treatments are never duplicated.
- Plan builder UI in the new **Plans & Lab tab** (procedure picker with cost
  autofill, tooth, phase) and a **printable estimate**
  (`/print/estimate/:id`) with phase grouping, totals, a 30-day validity note,
  and patient-acceptance + doctor signature lines — same letterhead pattern as
  invoices.

### 3.3 Dental lab work tracking

**Missing:** Crowns, bridges, dentures and aligners physically leave the
clinic. Open Dental's "lab cases" and Dentrix's Lab Case Manager track what's
out, at which lab, and when it's due back; we had nothing, which in practice
means patients booked for a fitting before the crown has arrived.

**Implemented:**
- New `LabWork` model: lab name, work type, tooth, shade, sent/due/received
  dates, cost, status `SENT → RECEIVED → FITTED` (plus `REDO`, `CANCELLED`).
- UI in the Plans & Lab tab with one-click status transitions and overdue
  highlighting; the **dashboard** now shows open lab cases and an alert count
  for overdue ones, so the morning glance answers "is the crown back?".
- Every transition writes a timeline event; lab cost feeds the expenses habit
  (record the lab bill as a `LAB` expense).

### 3.4 Inventory with low-stock alerts

**Missing:** Carestack, Practo, Dentee all track consumables; running out of
gloves or lidocaine mid-day is an operational failure the software should
prevent. We had no stock concept at all.

**Implemented:**
- New `InventoryItem` + `StockTxn` models. Stock is only changed through
  transactions (`RECEIVE / CONSUME / ADJUST / EXPIRED`, each attributed to the
  signed-in user), so every quantity has an audit trail; negative stock is
  rejected server-side.
- New **Inventory page**: item list with category, unit, stock vs reorder
  level, LOW STOCK badges, one-click receive/use modals, per-item transaction
  history, expiry dates. Item catalog management is `DOCTOR/ADMIN`; day-to-day
  stock adjustments are open to reception (they physically handle supplies).
- The dashboard surfaces low stock in its **Lab work & stock** card. Seed data
  ships a starter catalog of five common items.

### 3.5 Expense tracking and profit & loss

**Missing:** We reported revenue only. Every India-focused competitor pairs
collections with an expense register so the owner-dentist sees actual
profitability without exporting to a spreadsheet.

**Implemented:**
- New `Expense` model (date, category `RENT/SALARY/LAB/MATERIALS/EQUIPMENT/
  UTILITIES/MARKETING/OTHER`, amount, payment method, recorded-by).
- New **Expenses page** (doctor/admin; deletion admin-only) with date-range
  totals, and a new **`/api/reports/pnl`** endpoint powering a Profit & Loss
  card on the Reports page: collections vs expenses vs net for any range, with
  an expense-by-category breakdown. Reception cannot see any of it (server 403,
  nav entry hidden).

### 3.6 Automated recall campaigns + birthday greetings

**Missing:** We *listed* inactive patients (recall report) but never contacted
them — competitors' recall systems actually send the "time for your 6-month
check-up" message. Birthday wishes (a Practo/Carestack staple for retention)
didn't exist.

**Implemented:** Two new jobs in the existing 15-minute scheduler
(`reminders.scheduler.ts`), both using the message-log dedupe that makes every
scheduler job idempotent:
- **Recall:** patients whose last *completed* appointment is older than the
  configurable `recall.months` setting (default 6, `0` disables), who have
  nothing booked and no pending follow-up (those already get nudges), receive
  a "time for a check-up, reply YES to book" message — at most once per 60
  days per patient.
- **Birthday:** patients whose date of birth matches today get a greeting,
  at most once per year (toggle via the `greetings.birthday` setting).
Both settings are editable on the Settings page, and both messages flow
through the same provider abstraction (console offline, webhook live) and
land in the patient's message log and timeline.

### 3.7 Printable consent forms

**Missing:** Signed informed consent before extractions/RCT/implants is a
medico-legal requirement; competitors ship consent-form libraries. We had no
consent artifact at all.

**Implemented:** Four print-styled consent templates (general treatment,
extraction, root canal, implant) at `/print/consent/:patientId/:type` —
pre-filled with patient name/ID/age, clinic letterhead, procedure-specific
risk lists, and signature/date blocks. The Documents tab links to them, and a
new `CONSENT` document category stores the scanned signed copy against the
patient. This follows the deliberate print-to-PDF decision (see
DESIGN-DECISIONS §7) rather than adding an e-signature dependency.

### 3.8 Referral-source tracking

**Missing:** "How did you hear about us?" — the one field that tells a clinic
which marketing works. All competitors capture it.

**Implemented:** `Patient.referralSource` (walk-in / Google / friend & family /
doctor referral / social media / other) on the registration form, plus a
**"Where patients come from"** report card driven by `/api/reports/referrals`.

## 4. Fault-free verification

- `tsc --noEmit` clean on both server and client; `prisma db push` + seed ran
  against the live database without data loss.
- Every new endpoint exercised against the running system: FDI validation
  rejects tooth "99" (400), invalid conditions/statuses rejected, receptionist
  gets 403 on all clinical/financial writes (tooth findings, plans, lab work,
  item catalog, expenses) while retaining read access and stock adjustments,
  over-consuming stock is blocked, plan acceptance created exactly 2 treatments
  and re-acceptance created none, lab status transitions stamp `receivedAt`,
  P&L math cross-checked (revenue 3000 − expenses 2500 = net 500), scheduler
  ran with the new recall/birthday jobs without error, dashboard returns the
  new lab/stock alert blocks, and all new client modules serve through Vite.
- Existing behavior re-checked after the changes: backup endpoint, timeline,
  reminders all still pass.

## 5. Gaps deliberately not implemented

| Gap | Why deferred |
|---|---|
| **US-style insurance claims (EDI/X12, CDT codes)** | Target user is an Indian small clinic — cash/UPI dominant. The `INSURANCE` document category covers the occasional reimbursement letter. Building claims infrastructure would be the single largest module in the product for near-zero local value. |
| **Patient portal / online self-booking** | Requires public hosting, accounts, and support burden — against the local-first design. The WhatsApp reply loop ("YES to book") already covers the main use case; revisit when the clinic moves to cloud hosting (ARCHITECTURE §8). |
| **Imaging device integration (TWAIN/DICOM sensors)** | Hardware-specific drivers; out of scope for a web app. X-ray upload + comparison viewer covers the workflow at this scale. |
| **E-signature on consent/estimates** | Print-and-sign then upload the scan is legally sufficient locally and keeps zero new dependencies; consistent with the print-to-PDF decision. |
| **Multi-operatory / per-provider calendar columns** | Single-doctor clinic today. `Appointment.doctorId` already exists, so per-provider views are a UI filter away when a second chair arrives. |
| **Payroll / full accounting** | The expense register + P&L answers the owner's question ("am I profitable?"); a PMS should not try to replace an accountant. |

## 6. Where this leaves the product

After this iteration the system matches or exceeds the small-clinic feature set
of Practo Ray/Dentee (charting, plans, lab, inventory, expenses, recall,
consent, attribution) while keeping its existing advantages — offline-first
operation, WhatsApp-native automation, an append-only AI-ready timeline, and a
one-file database with one-zip backups. The remaining gaps are all either
US-market-specific or hosting-model decisions, not missing product.
