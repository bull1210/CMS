# User Guide

How to run and use the clinic management system, day to day.

---

## 1. Starting the system

Open two terminals:

```powershell
# Terminal 1 — API server
cd E:\apps\CMS\server
npm run dev            # starts on http://localhost:4000

# Terminal 2 — Web app
cd E:\apps\CMS\client
npm run dev            # starts on http://localhost:5173
```

Open **http://localhost:5173** in a browser.

First-time setup only (already done on this machine):

```powershell
cd E:\apps\CMS\server
npm install
npx prisma db push     # creates the database
npm run db:seed        # demo users, procedure catalog, sample patients
cd ..\client
npm install
```

### Using it from other devices (reception desk, second room)

Both servers run on the main laptop. On any phone/PC on the same Wi-Fi, open
`http://<laptop-ip>:5173` (find the IP with `ipconfig`).

### Sign-in accounts

| Role | Email | Password | Can do |
|---|---|---|---|
| Doctor | doctor@clinic.local | doctor123 | Everything clinical + billing |
| Receptionist | reception@clinic.local | reception123 | Register patients, schedule, collect payments, send messages — **not** medical records |
| Admin | admin@clinic.local | admin123 | Users, settings, backups, reports |

Change these passwords in **Settings → Users** before real use. Sessions expire
after 12 hours.

---

## 2. A typical day (doctor)

1. **Sign in → Dashboard.** A greeting banner shows how many patients are booked
   today and who's in the clinic now, then today's appointments, who is waiting,
   follow-ups due this week, patients with treatments in progress, revenue so far,
   and lab-work/low-stock cards.
   The **at-risk** card ("Might not turn up") ranks the next 48 hours by no-show risk,
   with the reasons ("2 previous no-shows · not confirmed yet") and a
   tap-to-call number — this is the front desk's morning call list. High-risk
   patients also get an extra automatic confirmation message.
2. When a patient arrives, reception marks them **waiting** (dropdown on the
   dashboard row, or via Appointments → Manage).
3. Click the patient's name to open their **chart**. Red badges at the top warn
   about diabetes, BP, heart conditions, allergies, smoking, pregnancy. A red
   box shows any **outstanding balance** — visible before you start treating.
4. Work through the tabs (see §4). When done, set the appointment to
   **completed**.

## 3. Front desk workflows (receptionist)

### Register a patient
**Patients → New patient.** Name and phone are mandatory; everything else
(WhatsApp, email, DOB, address, emergency contact, referral source, medical
checkboxes, dental history) is optional and editable later. A patient ID
(P-0001…) is assigned automatically.

If the phone number already belongs to a registered patient you'll see a
warning naming them — open their chart instead of creating a duplicate, or
press **Create anyway (shared phone)** for a family member using the same
number.

**Archiving:** when a patient moves away, switches clinics, or passes away,
edit their chart and tick **Archive this patient** (with a reason). All
history stays visible, but every automated message — reminders, recall,
birthdays — stops immediately. Untick to re-activate.

### Book an appointment
Three ways:
- **Appointments → New** — search the patient by name/phone, pick date, time,
  duration, type (consultation / follow-up / procedure / emergency).
- **Patient chart → Book** button.
- **Patient chart → amber "Recommended next" strip → book now** — this books
  the recommended follow-up procedure and marks the follow-up as booked.

As you pick the day and time the form checks the slot live and warns you
**before** booking if it **overlaps another appointment** ("That time is already
taken — overlaps <name>") or is **in the past**. The button changes to *Book
anyway* — you can still double-book on purpose, front-desk judgement wins. The
same overlap check runs when you **reschedule**. Booking a visit for an
**archived** patient is blocked — re-activate the chart first (usually it means
the wrong patient was picked).

### Manage the queue
Appointment statuses flow: **scheduled → confirmed → waiting → completed**,
with **cancelled** and **no-show** as exits. Change status from the dashboard
dropdown, or click any appointment in the calendar (day/week/month views,
navigate with ‹ Today ›).

### Collect a payment
**Patient chart → Billing tab → Record.** Enter amount and method (cash / card /
UPI / bank), optionally against a specific invoice. Partially paid invoices show
the remaining due; the patient's outstanding banner updates instantly.

## 4. The patient chart (tabs)

- **Timeline** — every event in chronological order: registrations,
  appointments, diagnoses, treatments, invoices, payments, uploads,
  prescriptions, messages sent and replies received. This is the "what happened
  with this patient" screen.
- **Dental Chart** *(doctor charts, everyone can view)* — the odontogram. Both
  arches in FDI numbering (adult/primary toggle); each tooth is colored by its
  condition (caries, filled, crown, root canal, implant, fractured, missing).
  Click a tooth to see its findings and past treatments, chart a new finding,
  or mark one resolved after treating it.
- **Plans & Lab** — phased **treatment plans / cost estimates**: build a plan
  from the procedure catalog, print the estimate for the patient to sign, then
  press *Patient accepted* — every line becomes a planned treatment
  automatically. Below it, **lab work**: crowns/bridges/dentures sent out, with
  expected dates, overdue highlighting, and received → fitted transitions.
- **Clinical** *(doctor only for editing)* —
  - **Diagnoses**: pick a template (Root Canal, Crown, Filling, Extraction,
    Cleaning) to pre-fill symptoms/observations/diagnosis, then edit and save.
  - **Treatments**: pick a procedure from the catalog (cost auto-fills, tooth
    number optional, FDI notation). Buttons move it **planned → in progress →
    complete**. If the procedure has a defined next step, the Complete button
    tells you what it will recommend.
- **Billing** — invoices (with per-item lines, discount, tax from settings) and
  payments. Click an invoice number to open the **printable invoice**; press
  *Print / Save PDF*.
- **Documents** *(doctor uploads)* — X-rays, scans, prescriptions, lab reports,
  insurance, signed consents. JPG/PNG/WEBP/PDF up to 25 MB. **Consent forms**:
  print a pre-filled template (general / extraction / root canal / implant),
  have the patient sign it, and upload the scan under the CONSENT category. Click an image to open the viewer;
  other images appear as a thumbnail strip for comparison; click the large
  image to open full-size.
- **Prescriptions** *(doctor)* — pick a template (post-extraction,
  post-root-canal, analgesic) or build one. For each medicine you type the name
  (it autocompletes from your medicine list and fills in the usual dose), then
  **tap Morning / Afternoon / Night** to say when to take it — no need to know
  the `1-0-1` shorthand, which is generated for the printout. Pick a duration and
  note the same way, or type your own. Save, then **Print** for the ℞ layout with
  signature line.
  - **Allergy safety.** If a medicine clashes with the patient's recorded
    allergy — including drug *families* (a "penicillin" allergy flags
    amoxicillin, augmentin, etc.) — a red **allergy warning** appears and Save
    stays disabled until you tick *"I have reviewed this and want to prescribe
    anyway"*. It warns, never blocks — you stay in charge.
  - **Rx library** (button next to *New prescription*) is where you maintain the
    reusable lists: *Templates* (add/delete your own; the three shipped ones are
    read-only) and *Medicines* (your formulary — what the autocomplete offers).
    Saving one tab keeps the window open; an unsaved-changes dot warns you before
    you lose work. Both lists are clinic-wide and doctor/admin editable.
- **Messages** — full WhatsApp/SMS log for this patient. Type a free-form
  message and Send. If the clinic reads replies manually, record them with the
  YES / NO / RESCHEDULE buttons — a YES on an appointment questionnaire
  auto-confirms the appointment; NO cancels it.

## 5. The recommendation engine (how follow-ups happen)

1. Admin/doctor defines flows in **Treatments** (sidebar): e.g. *Root Canal
   Stage 1 → recommended follow-up: Root Canal Stage 2, suggested after 14 days*.
2. When the doctor marks a Stage 1 treatment **complete**, the system:
   - creates a follow-up due in 14 days → appears in **Dashboard → Follow-ups
     due** and on the patient chart as *"Recommended next"*;
   - sends the patient: *"Based on your recent Root Canal Stage 1, Dr. Sharma
     recommends Root Canal Stage 2… Reply YES to schedule."*
3. Booking from the amber strip marks the follow-up **booked**; completing the
   Stage 2 treatment continues the chain (→ Crown).

## 6. Automated reminders

Runs automatically every 15 minutes (also **Settings → Run scheduler now**):

- **Appointment reminders** at the offsets configured in Settings
  (default `3d,1d,2h` before the slot), with *1 = Confirm, 2 = Reschedule,
  3 = Cancel* options.
- **Questionnaire** one day before: *"Will you attend tomorrow's appointment?"*
- **Follow-up nudges** for due follow-ups, at most once a week per follow-up.
- **Recall invitations** — patients with no visit for `Recall after (months)`
  (Settings, default 6) and nothing booked get a "time for a check-up" message,
  at most once per 60 days. Set to 0 to disable.
- **Birthday greetings** — automatic wishes on the patient's birthday
  (Settings → Birthday greetings on/off).

Nothing is ever sent twice for the same appointment/offset.

**Going live with WhatsApp (recommended):** connect your clinic's WhatsApp
number directly to Meta's Cloud API — no middleman. In **Settings → WhatsApp**
paste the Phone Number ID and permanent access token from your Meta developer
app (WhatsApp → API Setup), invent a verify token, and save. Then in Meta's
dashboard (WhatsApp → Configuration → Webhook) paste the callback URL and
verify token the card shows you, and subscribe to the **messages** field. Use
**Send test** to confirm the pipe — it returns Meta's exact error when
something is off. Templates: create `appointment_reminder`, `recall_due` and
`follow_up_due` (category *Utility*, body-only) in WhatsApp Manager; the
system automatically uses them when a patient hasn't messaged you in the last
24 hours (WhatsApp's rule) and plain text when they have. Delivery ticks
(Sent → Delivered → Seen) appear in the message log, and patient replies
(YES / 1 / 2 / 3) confirm or cancel appointments automatically. Meta-side
account setup (business verification, number, templates) is described in the
spec: `docs/superpowers/specs/2026-08-13-whatsapp-integration-design.md`.

**Going live via a generic SMS gateway (alternative):** set
**Settings → SMS/WhatsApp gateway URL** to an HTTP endpoint (Twilio function,
MSG91…). The system POSTs `{channel, to, body}` there. Point your gateway's
inbound webhook at `POST http://<server>/api/messages/inbound` with
`{from, body}` and replies are matched and processed automatically. When you
go live, also set **Settings → Inbound webhook token** and configure your
gateway to send it (`?token=…` or an `x-webhook-token` header) so nobody else
can post fake replies.

## 7. Search

The top search bar finds, as you type (2+ characters): patients by **name,
phone, patient ID, email**, plus patients via **diagnosis text** and
**procedure name**. Click any result to jump to the chart.

## 8. Reports (doctor/admin)

**Reports** page, with a date-range picker:
- Revenue in range, by day (bars) and by payment method
- Most performed procedures (count, completed, value)
- New vs returning patients
- Cancellation, no-show, completion rates
- **Recall list**: patients inactive 6+ months or with pending treatment —
  your outreach call list.

**Billing** page: every patient with dues, sorted largest first, plus recent
invoices.

New report cards: **Profit & loss** (collections vs expenses vs net for the
range, expenses by category) and **Where patients come from** (referral
sources captured at registration).

**Revenue leakage radar** — one card totalling the money currently on the
table, in four buckets: work completed but never invoiced, invoices unpaid
more than two weeks, treatments the patient agreed to but never booked, and
follow-ups more than a week overdue. Every line links to the patient and shows
their phone — work through it weekly.

## 8a. Inventory & expenses

- **Stock** (sidebar) — consumables and materials with stock levels.
  Use **+ / −** to receive or consume stock (any staff member; every change is
  logged with who did it). Items at or below their reorder level show a LOW
  STOCK badge and appear in the dashboard's **Lab work & stock** card. Doctors/
  admins manage the item catalog itself.
- **Expenses** (sidebar, doctor/admin only) — record rent, salaries, lab bills,
  materials etc. The page shows collections vs expenses vs net for any date
  range; only admins can delete an entry.

## 9. Admin tasks

- **Settings → Clinic & messaging** — clinic name/address/phone (appears on
  printed invoices and prescriptions), primary doctor name (used in message
  templates), tax %, reminder offsets, gateway URL.
- **Settings → Users** — add doctors/receptionists, reset passwords,
  deactivate staff (deactivated users cannot log in; history is preserved).
- **Settings → Backups** — *Backup now* creates a zip of the entire database +
  every uploaded file; a backup also runs automatically at 01:30 daily.
  Download backups to a USB drive periodically.
- **Restore** — see `server/RESTORE.md`: stop the server, unzip the backup over
  the server folder, start again.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| Web app loads but everything errors | API server not running — start terminal 1 |
| "Session expired" | Sign in again (12h token expiry) |
| Reminder didn't send | Check Settings → Run scheduler now; messages appear in the patient's Messages tab and the server console |
| Receptionist gets "Insufficient role" | By design — medical records are doctor-only |
| "Too many failed attempts" at login | 5 wrong passwords lock that account for 15 minutes; wait, or restart the server |
| "A patient with this phone already exists" | Open the named patient's chart, or use **Create anyway** for a family member sharing the phone |
| A patient stopped receiving reminders | Check whether they're **Archived** (badge on their chart) — untick in Edit to resume |
| Forgot admin password | `cd server && npm run db:seed` re-creates missing demo users (existing data untouched) |
