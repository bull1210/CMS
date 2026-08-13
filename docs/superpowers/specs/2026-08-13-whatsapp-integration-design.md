# WhatsApp Business integration — Meta Cloud API (2026-08-13)

Sub-project C. Approved scope: **Meta Cloud API direct** (no BSP), **two-way**,
v1 automated kinds = appointment reminders + recall (plus follow-up nudges,
which reuse the same machinery). Per-clinic credentials live in the
tenant-scoped `Setting` table — the multi-tenancy work (sub-project A) makes
this per-clinic for free.

## Per-clinic settings keys

| Key | Meaning |
|---|---|
| `whatsapp.phoneNumberId` | Meta Phone Number ID (presence of this + token switches the provider on) |
| `whatsapp.accessToken` | permanent system-user token |
| `whatsapp.verifyToken` | invented string pasted into Meta's webhook form |
| `whatsapp.appSecret` | app secret for webhook signature verification (optional but recommended) |
| `whatsapp.templates` | JSON text `{"reminder":"appointment_reminder","recall":"recall_due","followup":"follow_up_due"}` |
| `whatsapp.lang` | template language code, default `en` |

Templates are **body-only** (no buttons) in v1 — patients reply by typing
(YES / 1 / 2 / 3 …), which the existing `recordReply()` parser already
understands. Button payload handling is a v2 nicety.

## Sending (`MessagingService.send`)

Provider chain per message: **WhatsApp Cloud** (when channel=WHATSAPP and the
clinic has phoneNumberId+accessToken) → legacy `messaging.webhookUrl` POST →
console log. Local dev with nothing configured behaves exactly as before.

The 24-hour rule: free-form text is only deliverable within 24h of the
patient's last inbound message. `Message.respondedAt` (new) records inbound
reply times; window open = any message to that number with
`respondedAt > now-24h` (tenant-scoped query).

- Window open → send `type: text` (the human-readable body every kind already
  builds).
- Window closed and the message carries a `template` payload
  (`{ key: reminder|recall|followup, params: [...] }`) → send `type: template`
  with body parameters.
- Window closed, no template (e.g. birthday, manual free-text) → attempt text;
  Meta rejects with re-engagement error → status FAILED with the real error
  stored in `Message.error`. Honest, visible in the message log.

`Message` additions: `waMessageId` (wamid, for status receipts),
`respondedAt`, `deliveredAt`, `readAt`, `error`. New statuses `DELIVERED`,
`READ` (added to client statusLabel/statusTone maps).

Scheduler kinds → template keys: REMINDER_*/QUESTIONNAIRE/RISK_CONFIRM →
`reminder` (params: patient, doctor, clinic, when), FOLLOW_UP → `followup`
(patient, treatment, doctor), RECALL → `recall` (patient, months, clinic).
BIRTHDAY stays text-only by design.

## Receiving (`/api/messages/whatsapp`, @Public)

Meta webhooks are configured once per Meta *app* and fan in for all clinics:

- **GET** = subscription handshake: echo `hub.challenge` when
  `hub.verify_token` matches ANY clinic's `whatsapp.verifyToken`
  (single-clinic laptop and manual multi-clinic onboarding both work).
- **POST** = events. Route by `entry[].changes[].value.metadata.phone_number_id`
  → the clinic whose `whatsapp.phoneNumberId` matches → all processing inside
  `tenancy.runAs(clinicId)`.
  - Signature: if that clinic has `whatsapp.appSecret`, verify
    `X-Hub-Signature-256` (HMAC-SHA256 of the raw body — `rawBody: true` in
    main.ts); mismatch → 403.
  - `messages[]` (patient replies): text/button content → match the latest
    SENT unanswered outbound message to that number → existing `recordReply()`
    (auto-confirm/cancel appointments) + stamp `respondedAt` (opens the 24h
    window). Unmatched numbers are acknowledged and ignored (same as the
    legacy inbound endpoint).
  - `statuses[]` (receipts): by wamid — `delivered` → status DELIVERED +
    `deliveredAt`; `read` → READ + `readAt`; `failed` → FAILED + error text.
- Always respond 200 quickly (Meta retries on non-200).

The legacy `/messages/inbound` endpoint stays (generic SMS gateways).

## Settings UI + test send

Settings page gets a **WhatsApp card** (DOCTOR/ADMIN): credential fields,
template names, read-only webhook URL + verify token to paste into Meta, and
a "Send test message" box → `POST /messages/test-whatsapp { to }` which sends
the reminder template with sample params and returns Meta's raw response —
the fastest way to see exactly what Meta thinks is wrong.

## Acceptance

- tsc clean both sides; console fallback unchanged when unconfigured.
- Live simulated: webhook handshake echoes challenge only for the right
  token; a faked Meta POST routes a reply to the correct clinic, updates the
  matched message, auto-confirms its appointment, stamps respondedAt; status
  receipts flip SENT → DELIVERED → READ on the right row.
