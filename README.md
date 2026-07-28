# Smile Dental — Clinic Management System

A modern, lightweight, AI-ready patient management system for dentists and small
clinics. Runs entirely on one laptop (SQLite + local file storage), designed to
migrate to the cloud (PostgreSQL + S3) without redesign.

## Stack

| Layer    | Technology                                            |
| -------- | ----------------------------------------------------- |
| Frontend | React 18 + TypeScript + Vite + Tailwind + React Query |
| Backend  | NestJS (Node.js) + Prisma ORM                         |
| Database | SQLite (swap `provider` in `schema.prisma` for PostgreSQL/MySQL) |
| Storage  | Local disk under `server/storage/uploads` (relative keys, S3-ready) |
| Auth     | JWT (12h expiry) with role-based access control       |

## Quick start

```powershell
# 1. API server (port 4000)
cd server
npm install
npx prisma db push       # creates prisma/clinic.db
npm run db:seed          # demo users, procedure catalog, sample patients
npm run dev

# 2. Web app (port 5173) — separate terminal
cd client
npm install
npm run dev
```

Open http://localhost:5173 and sign in:

| Role         | Email                  | Password     |
| ------------ | ---------------------- | ------------ |
| Doctor       | doctor@clinic.local    | doctor123    |
| Receptionist | reception@clinic.local | reception123 |
| Admin        | admin@clinic.local     | admin123     |

For LAN use (reception desk + consultation room), run both servers on the main
laptop and open `http://<laptop-ip>:5173` from other devices.

## What's included

- **Dashboard** — today's appointments (upcoming/waiting/completed/missed),
  follow-ups due, pending treatments ("N patients require a next procedure"),
  **at-risk appointments (no-show risk scores with reasons)**, lab cases out,
  low-stock items, revenue today/week/month, outstanding dues,
  recent patient replies.
- **Patients** — demographics, medical history flags (diabetes, BP, heart,
  allergies, smoking, pregnancy, medications), dental history, referral source,
  duplicate-phone detection at registration, archiving (stops all automated
  messages, keeps history), instant search (name/phone/ID/diagnosis/procedure),
  full chronological timeline of every event.
- **Dental chart (odontogram)** — interactive FDI tooth chart (adult/primary),
  per-tooth findings (caries/filled/crown/root canal/implant/fractured/missing)
  color-coded, with per-tooth treatment history.
- **Treatment plans & estimates** — phased multi-procedure plans, printable
  signed estimate; accepting a plan converts every item into planned treatments.
- **Lab work tracking** — crowns/bridges/dentures sent out: lab, shade, due
  date, sent → received → fitted, overdue alerts on the dashboard.
- **Diagnoses** — symptoms/observations/diagnosis/notes with quick templates
  (root canal, crown, filling, extraction, cleaning).
- **Procedure catalog & treatment flows** — each procedure has cost + optional
  recommended next procedure and interval (e.g. Root Canal Stage 1 → Stage 2
  after 14 days).
- **Smart recommendation engine** — completing a treatment auto-creates a
  follow-up (alerts the doctor on the dashboard) and sends the patient a
  WhatsApp/SMS recommendation ("Reply YES to schedule").
- **Appointments** — day/week/month calendar, types (consultation/follow-up/
  procedure/emergency), statuses (scheduled → confirmed → waiting → completed /
  cancelled / no-show), overlap warning, booking directly from a due follow-up.
- **Automated communication** — scheduler (every 15 min) sends configurable
  appointment reminders (`7d,3d,1d,2h` offsets), a will-you-attend questionnaire
  one day before, follow-up nudges, **recall invitations** (no visit for N
  months), **birthday greetings**, and an extra confirmation request for
  high-no-show-risk appointments. Replies (YES/NO/RESCHEDULE or 1/2/3) update
  the appointment automatically — via the `/api/messages/inbound` webhook
  (optionally secured with a shared token) from a real gateway, or recorded
  manually in the UI. Archived patients are never messaged.
- **Billing** — invoices with items/discount/tax, partial payments, per-patient
  outstanding banner, clinic-wide dues list, printable invoice (print → save as
  PDF) with payment history.
- **Prescriptions** — tap-to-dose builder (morning/afternoon/night chips instead
  of `1-0-1`), an editable template library and medicine formulary
  (autocomplete), and a **drug-allergy safety check** that warns — against drug
  families, not just exact names — before you prescribe something the chart flags.
  Printable ℞ layout.
- **Appointment safety** — live warnings, before you commit, on double-booking
  (on booking *and* reschedule) and past dates; archived patients can't be booked.
- **Consent forms** — printable pre-filled templates (general/extraction/root
  canal/implant) with risk lists and signature blocks; signed scans stored
  under the CONSENT document category.
- **Documents** — X-ray/prescription/scan/lab-report/insurance/consent uploads
  (JPG/PNG/WEBP/PDF, MIME + extension checked), image viewer with thumbnail
  comparison strip.
- **Inventory** — consumables with stock levels, attributed stock transactions,
  reorder thresholds, low-stock dashboard alerts, expiry dates.
- **Expenses & P&L** — expense register by category; collections vs expenses
  vs net for any date range.
- **Reports** — revenue by day/method, profit & loss, **revenue leakage radar**
  (unbilled completed work, stale unpaid invoices, agreed-but-unbooked
  treatments, overdue follow-ups — with the total ₹ on the table), most
  performed procedures, new vs returning patients, cancellation/no-show rates,
  referral sources, recall list.
- **Admin & security** — user management (deactivation revokes access
  instantly), clinic/messaging/reminder/recall settings, audit log (including
  failed logins), login brute-force lockout, auto-generated JWT secret,
  one-click backup (DB + all attachments zipped, nightly at 01:30), restore via
  `server/RESTORE.md`.

## Roles

- **Doctor** — everything clinical + billing.
- **Receptionist** — register patients, schedule, collect payments, send
  reminders, update contacts. Blocked (HTTP 403) from diagnoses, treatments,
  prescriptions, document uploads, and the procedure catalog.
- **Admin** — users, settings, messaging providers, backups, reports.

## Architecture

```
client/  React SPA (Vite proxies /api and /files to the server)
server/
  prisma/schema.prisma      single source of truth for the data model
  src/core/                 Prisma + timeline + audit (global), JWT auth guard
  src/modules/              one NestJS module per domain:
    auth users patients procedures diagnoses treatments appointments(+risk)
    billing documents prescriptions followups messaging(+scheduler) dashboard
    reports search settings(backup) tooth-findings plans labworks
    inventory expenses
  storage/uploads/          attachments   storage/backups/  zips
```

Design decisions that keep it cloud- and AI-ready:

- **TimelineEvent** is an append-only per-patient event stream — the substrate
  for the timeline UI today and AI clinical summaries/recall campaigns later.
- **Messaging is provider-abstracted**: set `messaging.webhookUrl` in Settings
  to point at any WhatsApp Cloud API / Twilio relay; empty = console provider
  (logs locally, everything else still works).
- **Documents store relative keys**, not absolute paths — an S3 adapter only
  swaps read/write.
- **No SQLite-specific SQL** — Prisma throughout; switching to PostgreSQL is a
  one-line provider change plus `prisma migrate`.
- **AuditLog** records every mutation with user, action, entity.

## Documentation

| Document | Contents |
|---|---|
| `docs/USER-GUIDE.md` | How to run and use it, per role, day to day |
| `docs/ARCHITECTURE.md` | Diagrams, request lifecycle, data model, engines, migration paths |
| `docs/DESIGN-DECISIONS.md` | Why it's built this way — alternatives and trade-offs |
| `docs/GAP-ANALYSIS.md` | Competitor comparison and how each gap was closed |
| `docs/CRITIQUE-AND-FIXES.md` | No-show risk engine, leakage radar, and every security loophole found & fixed |
| `CLAUDE.md` | Conventions and commands for AI-assisted development |

## API smoke test

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"doctor@clinic.local","password":"doctor123"}'
```
