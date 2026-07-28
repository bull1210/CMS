# Critique & Fixes

The system reviewed three ways — as an inventor looking for something genuinely
new in the dental-PMS domain, as a serious daily user, and as a hostile critic
hunting for loopholes. Every issue below is **fixed and verified in the
codebase**; nothing here is a proposal.

---

## Part 1 — The genuinely new ideas

### 1.1 The Revenue Leakage Radar (new to this domain)

Every PMS reports what the clinic *earned*. None of them answer the question
the owner actually loses sleep over: **"how much money is silently slipping
through the cracks?"** Fragments exist (Dentrix has an "unscheduled treatment"
report), but no product unifies leakage into one number with a work list.

`GET /api/reports/leakage` scans four cracks money falls through, and the
Reports page shows them as one card headlined with the total ₹ on the table:

| Crack | What it catches | Why it happens in real clinics |
|---|---|---|
| **Completed but never invoiced** | `COMPLETED` treatments with cost > 0 and no invoice | Busy day: the doctor finishes, the patient walks past the desk |
| **Unpaid invoices > 14 days** | OPEN/PARTIAL invoices with their pending amount | "Pay next visit" — and the next visit never comes |
| **Agreed treatments, nothing booked** | `PLANNED` treatments whose patient has no upcoming appointment | The patient said yes, left, and drifted |
| **Follow-ups overdue > 7 days** | PENDING follow-ups a week past due, with estimated value | The chain (RCT → crown) broke silently |

Every line links to the patient chart and shows a phone number — it's a call
list, not a chart. Archived patients are excluded, so the number is honest.

### 1.2 The No-Show Risk Engine (fix for the most common issue)

The single most common operational pain reported by small clinics is the
**no-show** — industry no-show rates for dental run 10–20%, and every empty
chair-hour is unrecoverable revenue. Everyone sends reminders; the problem is
reminders treat all patients the same, while no-show behavior is intensely
personal.

`GET /api/appointments/risk` scores every upcoming appointment (48h horizon)
from signals the system already records — **explainable heuristics, not a
black box**, so the front desk sees *why*:

- previous no-shows (strongest predictor: +20/+35)
- appointment still unconfirmed (+20)
- reminders sent for it went unanswered > 4h (+15)
- first-ever visit, no relationship yet (+15)
- booked > 14 days ahead, easily forgotten (+10)

Score ≥ 60 = HIGH, ≥ 30 = MEDIUM. Two consumers:

1. **Dashboard card "At-risk appointments — worth a confirmation call"**:
   ranked list with score chip, the reasons in plain words, and a tap-to-call
   phone number.
2. **Scheduler**: HIGH-risk appointments within 24h automatically get one
   extra, warmer confirmation message ("Dr. Sharma has reserved this slot
   especially for you — can we count on you?"), deduped like every other
   automated message (kind `RISK_CONFIRM`).

The feature layer is deliberately model-ready: the scoring function consumes
exactly the features a future learned model would, so upgrading it later means
swapping one service method.

## Part 2 — Thinking like a serious daily user

Use cases a real front desk / owner-dentist hits that the system now covers:

- **"Two patients, one phone."** Families share numbers. Registration now
  warns about a duplicate chart but lets you consciously override
  (§3.5) — both mistakes (silent duplicate, hard block) are avoided.
- **"This patient moved to Bangalore / passed away."** Archiving (§3.7) stops
  every automated message instantly while preserving the full record. The
  worst possible automated message — a recall SMS to a deceased patient's
  family — can no longer happen.
- **"Who do I call this morning?"** The dashboard now answers in priority
  order: at-risk appointments today, overdue lab cases, low stock, overdue
  follow-ups, unpaid bills.
- **"Did we actually get paid for everything we did this month?"** The
  leakage radar (§1.1) is the one-glance answer.
- **"The receptionist quit; kill her access now."** Deactivation is now
  immediate (§3.1), not "sometime in the next 12 hours".
- **"I fat-fingered the wrong invoice."** Voiding is now safe: an invoice
  with payments refuses to void instead of corrupting balances (§3.4).

## Part 3 — Thinking like a hostile critic: loopholes found & fixed

Each entry: the loophole, why it's dangerous, the fix, and how it was verified
against the running system.

### 3.1 Deactivated staff kept working access for up to 12 hours
**Loophole:** The auth guard only verified the JWT signature. Deactivating a
user blocked new logins but every already-issued token stayed valid until
expiry — a fired employee could read and modify records for 12 more hours.
**Fix:** The guard now checks the user row (`active`, current `role`) on every
request; deactivation and role changes take effect on the very next request.
**Verified:** deactivated the receptionist → her live token immediately
returned 401; reactivated → 200.

### 3.2 The inbound message webhook was spoofable
**Loophole:** `/api/messages/inbound` must be public (gateways can't log in),
but anyone on the LAN could POST `{"from": "+91…", "body": "NO"}` and silently
**cancel another patient's appointment** through the reply-interpretation
logic.
**Fix:** New `messaging.inboundToken` setting (Settings page). Once set, the
webhook requires the shared secret via `?token=` or `x-webhook-token` header.
Left empty, local/offline demos keep working — going live with a gateway is
when you set it, alongside the gateway URL.
**Verified:** with token set — no/wrong token → 401, correct token → 201.

### 3.3 Login had no brute-force protection
**Loophole:** Unlimited password guesses at machine speed against three
well-known demo emails; failed attempts weren't even logged.
**Fix:** 5 failed attempts per email → 15-minute lockout (even the correct
password is refused while locked, so an attacker can't confirm a hit); every
failure writes a `LOGIN_FAILED` audit row.
**Verified:** 6th attempt and a correct-password attempt both return "Too many
failed attempts — try again in 15 min".

### 3.4 Billing math could be silently corrupted
**Loophole (three variants):** a payment could target a **voided** invoice or
**another patient's** invoice, and an invoice **with payments** could be
voided. All three desynchronize the derived outstanding balance — the number
on the patient banner the doctor trusts before treating.
**Fix:** Payments validate the target invoice (exists, same patient, not
VOID); voiding an invoice with recorded payments is refused with a clear
message.
**Verified:** all three now return 400 with specific messages.

### 3.5 Duplicate patient charts
**Loophole:** Registering the same person twice (the most common front-desk
data error) silently split their medical history and billing across two
charts.
**Fix:** Registration checks the phone number; a match returns 409 naming the
existing patient ("John Mathew, P-0001 — open their chart"), and the form
offers an explicit **"Create anyway (shared phone)"** override for family
members.
**Verified:** duplicate → 409 with the existing patient named; `force: true`
→ created.

### 3.6 Race conditions in "generate the next number" logic
**Loophole:** Patient codes and invoice numbers derived from `count + 1` —
two concurrent registrations could collide and crash with an opaque 500. Plan
acceptance had the same shape: two rapid "Accept" clicks could both pass the
status check and **create every treatment twice**.
**Fix:** Patient codes now derive from the collision-free autoincrement id;
invoice creation retries on unique-collision; plan acceptance atomically
claims `PROPOSED → ACCEPTED` with a conditional update, so exactly one accept
can ever win.
**Verified:** new patient got id-derived code (P-0005 = id 5); accept then
re-accept created treatments exactly once (2, not 4).

### 3.7 No way to stop messaging someone (archiving)
**Loophole:** Patients could never be marked inactive. The recall engine would
message people who moved cities — or worse, deceased patients — forever.
**Fix:** `Patient.active` + reason (moved away / switched clinic / deceased /
other). Archiving is a checkbox in the edit form; the chart shows an
**Archived** badge; every scheduler job (reminders, questionnaires, follow-up
nudges, recall, birthdays, risk confirmations) and every outreach list
(recall report, leakage radar, risk scores) excludes archived patients.
History, billing and documents remain fully visible.
**Verified:** archived patient vanished from recall and leakage; scheduler run
sent 0 messages to them; timeline records "Patient archived (moved away)".

### 3.8 Database errors surfaced as blank 500s
**Loophole:** Any unique-constraint hit (e.g. duplicate inventory item name)
returned "Internal server error" — indistinguishable from a crash, and
unactionable for staff.
**Fix:** A global Prisma exception filter maps known errors: unique violation
→ 409 with the offending field, missing record → 404, broken reference → 400.
**Verified:** duplicate inventory name now returns
`409 "Already exists — name must be unique"`.

### 3.9 Guessable JWT signing secret
**Loophole:** Without a configured `JWT_SECRET` the server fell back to the
literal string `dev-secret` — anyone reading the source could forge an admin
token from any device on the clinic Wi-Fi.
**Fix:** On boot, a missing (or default) secret is replaced by a
cryptographically random 256-bit value persisted to `.env`, so sessions
survive restarts and no two installations share a secret.
**Verified:** `.env` now contains a generated `JWT_SECRET`; auth works across
restarts.

### 3.10 Upload type checking trusted the client
**Loophole:** File-type enforcement used only the client-declared MIME type —
`evil.exe` uploaded with a `application/pdf` label was accepted and stored.
**Fix:** Both the MIME type *and* the actual file extension must be in the
allowlist (JPG/PNG/WEBP/PDF); either failing deletes the temp file and rejects.
(Uploads were already never executed — served statically with generated names —
so this is defense in depth.)
**Verified:** `.exe` with a PDF MIME label → 400.

### 3.11 Clinical records could be rewritten through status loopholes
**Loophole:** Treatment statuses had no transition rules: a COMPLETED
treatment could be flipped back to PLANNED (rewriting clinical history), and
re-completing one would re-fire the follow-up engine.
**Fix:** Explicit transition map — terminal states are terminal
(`COMPLETED → nothing`, `CANCELLED → PLANNED` only), with a plain-language
error for anything else.
**Verified:** COMPLETED → PLANNED and COMPLETED → COMPLETED both return 400.

### 3.12 Accepted limitations (known, deliberate — not silently ignored)
- **Double-booking is a warning, not a block** — front-desk judgement wins by
  design (emergencies overbook).
- **In-app backup restore** remains a documented manual step — overwriting a
  live SQLite file on Windows is riskier than three manual steps.
- **The login throttle is in-memory** — a restart clears it. Acceptable for a
  single-process local server; the audit log keeps the permanent record.
- **Leakage "unbilled" matching** uses the invoice↔treatment link; an invoice
  typed manually without linking the treatment still counts as unbilled. The
  radar over-reports rather than under-reports — the safe direction.

## Part 4 — Verification summary

`tsc --noEmit` clean on server and client. Schema migrated in place
(`Patient.active`, `inactiveReason`) with zero data loss. All 11 fixed
loopholes exercised against the live API with both positive and negative
cases, plus both new engines: the risk endpoint returned a scored, reasoned
list (e.g. *"30 MEDIUM — 2 unanswered reminders / First visit"*), and the
leakage radar found real leakage in the demo data (₹3,500 unbilled + ₹3,500
drifting). Existing regression points re-checked: reminders, backup, RBAC,
timeline, and every page served through Vite.
