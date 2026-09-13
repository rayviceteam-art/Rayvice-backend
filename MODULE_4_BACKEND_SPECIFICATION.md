# RAYVICE — MODULE 4 BACKEND MASTER SPECIFICATION
## Shift Logging & Deterministic NDIS Auto-Split Engine

**Version:** 1.0 (FINAL — APPROVED)
**Module:** 4 of 5
**Status:** Ready for implementation
**Audience:** Any AI coding agent or developer implementing this module
**Companion document:** `MODULE_4_FRONTEND_SPECIFICATION.md` (separate file)

---

## SECTION 0 — HOW TO USE THIS DOCUMENT (BINDING RULES FOR IMPLEMENTERS)

This document is the **single source of truth** for Module 4 backend. Read it fully before writing any code.

### 0.1 Non-negotiable rules

1. **DO NOT INVENT FEATURES.** If it is not written in this document, it does not get built. Do not add "nice to have" fields, endpoints, statuses, tiers, or behaviours.
2. **DO NOT CHANGE MODULES 1, 2, 3.** Existing auth, business, and client code must remain behaviourally identical. Only these additive changes are allowed (all listed in Section 6): new Prisma models/enums/fields, new audit actions, new trial resource type, new client-budget recompute helper call.
3. **DO NOT GUESS RATES.** All money values come from the `NdisSupportItem` database table (already seeded). Never hardcode 67.56 / 74.42 / 95.07 / 122.59 / 150.12 / 0.97 anywhere in Module 4 logic.
4. **DO NOT GUESS ITEM CODES.** The exact codes are listed in Section 4.2 and already exist in the catalogue.
5. **DO NOT SKIP TENANT SCOPING.** Every single Prisma query MUST filter by `businessId: req.user.businessId`. A bare `findMany()` without tenant scope is a security bug.
6. **DO NOT SKIP AUDIT LOGGING.** Every create / update / delete MUST call `recordAuditEvent()`.
7. **DO NOT SKIP VALIDATION.** Every endpoint must be validated with `validateRequest()` + Zod before reaching the controller.
8. **DO NOT STORE AUDIO FILES.** Voice audio is processed in memory and discarded. Never write audio to disk, never upload audio to object storage.
9. **DO NOT SEND PARTICIPANT IDENTITY TO AI PROVIDERS.** Only the participant's *first name* may ever leave the server (details in Section 11.6).
10. **DO NOT AUTO-SAVE AI OUTPUT.** Voice parsing returns a *preview*. The worker must confirm through the normal create/update flow.
11. **DO NOT USE FLOATING-POINT MATH FOR MONEY.** Use `Prisma.Decimal` end-to-end (`@db.Decimal(10, 2)`), round each line to 2 decimals, then sum the rounded lines.
12. **DO NOT USE `new Date().getUTCDay()`** for weekday/rate-tier decisions. All tier decisions happen in the business timezone (Section 5).
13. **DO NOT ALLOW EDITING AN INVOICED SHIFT.** Once `status = INVOICED` or `isInvoiced = true`, the shift is immutable. Any edit/delete attempt returns `409 SHIFT_ALREADY_INVOICED`.
14. **DO NOT BUILD SLEEPOVER SUPPORT.** It is deliberately deferred to v2 (Section 18). Do not add a sleepover item code or a "sleepover mode" toggle.

### 0.2 Definition of Done for this module

Module 4 is complete only when **every** item in Section 17 (Acceptance Criteria) passes, every test in Section 15 exists and passes, and `npm run typecheck` + existing test suite are green.

---

## SECTION 1 — PROJECT CONTEXT (WHY RAYVICE AND MODULE 4 EXIST)

### 1.1 What Rayvice is

Rayvice is a **billing and NDIS-compliance operating system for Australian NDIS sole-trader support workers**. It is a multi-tenant SaaS (each business = one tenant) built as:

- **Backend:** Node.js + Express + TypeScript + Prisma + PostgreSQL (Neon)
- **Frontend:** Next.js 14 (App Router) + Tailwind (dark theme)
- **Deployment:** Backend on Render, frontend on Vercel, database on Neon

The product exists because independent NDIS support workers lose **5+ hours every week** to manual Excel billing, and invoices get **rejected by plan managers for small formatting/pricing errors**, delaying payment by **3–6 weeks** and wrecking their cashflow.

### 1.2 The five modules

| Module | Name | Purpose |
|---|---|---|
| 1 | Authentication & Session | Register business, login, JWT + refresh rotation, team invites |
| 2 | Business Profile & Banking | ABN, BSB, account, invoice prefix, GST toggle, compliance |
| 3 | NDIS Participant & Plan Manager Directory | Participants, 9-digit NDIS numbers, plan-manager routing, budgets |
| **4** | **Shift Logging & Auto-Split Engine** | **Log worked shifts (manual + voice) and auto-calculate the exact NDIS claim amount** |
| 5 | Invoicing & Auto-Rejection Shield | Generate compliant tax invoices and email them to plan managers |

### 1.3 Why Module 4 is the heart of the product

The Australian **NDIS Price Guide** does not pay one flat hourly rate. The payable rate depends on **when** the support was delivered:

- Weekday daytime is capped at **$67.56/hr**
- Weekday evening (after 8:00 PM) is capped at **$74.42/hr**
- Saturday is capped at **$95.07/hr**
- Sunday is capped at **$122.59/hr**
- Public holidays are capped at **$150.12/hr**
- Activity-based transport is **$0.97/km**

A single shift (e.g. 18:00 → 21:30 with 12 km of driving) must therefore be **split into multiple claim lines** across different item codes and rates. Doing this in Excel takes hours per week and produces rejected invoices.

**Module 4 removes that manual work entirely.** It converts a logged shift into exact, NDIS-compliant, capped claim line items in milliseconds — deterministically, with an audit trail, and with a voice interface so a worker can log a shift from their car in under 15 seconds.

### 1.4 What "deterministic" means here (and why it matters)

The same inputs MUST always produce the same outputs. The engine is pure arithmetic driven by a rate table — **there is no AI in the calculation path**. AI is used only to *transcribe and structure* voice input, and even that result must be human-confirmed. This guarantees that a tax invoice can always be reproduced and defended in an audit.

---

## SECTION 2 — SCOPE

### 2.1 In scope (v1 — build this)

1. Shift creation (manual) with automatic NDIS rate split.
2. Shift list, detail, edit (while uninvoiced), delete (while uninvoiced).
3. Overnight shift support via **midnight split**.
4. Business-timezone-aware day/hour decisions including daylight saving.
5. Automatic Australian public-holiday detection (state-based) + manual override flag.
6. Activity-based transport (km) claiming.
7. Voice-to-shift: audio upload → transcription (Groq Whisper) → structured JSON (Gemini) → human-confirmed prefill.
8. Budget tracking on the participant record (spend updates as shifts are logged).
9. Dashboard summary endpoint (earnings, uninvoiced, budget health, recent shifts).
10. Trial limits (5 shifts, 3 voice parses), plan gating for voice (Pro only).
11. Audit logging for every state change.
12. Unit tests for the calculation engine and validators.

### 2.2 Out of scope (v2 backlog — DO NOT BUILD NOW)

| # | Deferred item | Why deferred |
|---|---|---|
| 1 | Night-time **sleepover** support item (flat nightly rate) | Requires the official NDIS item code + rate from the client's price guide; guessing a code causes invoice rejection |
| 2 | Short-notice **cancellation** claims (NDIS cancellation rules) | Separate compliance rules; not needed for v1 |
| 3 | **PRODA / Myplace CSV export** | Part of the Pro plan feature set, belongs with Module 5 delivery work |
| 4 | **Offline shift queue** (PWA background sync) | v1 keeps a simple browser-local fallback only |
| 5 | **Billing increment rounding** (e.g. 15-minute blocks) | v1 bills exact minutes; rounding modes change money and need their own sign-off |
| 6 | **Remote / Very Remote** price regions | v1 uses the National rate column only (see Open Question Q1) |
| 7 | Public-holiday **rate overrides** per business | v1 uses the standard holiday tier |
| 8 | Plan-manager payment reminders | Module 5 / Pro feature |

---

## SECTION 3 — GLOSSARY (USE THESE TERMS EXACTLY)

| Term | Meaning in this codebase |
|---|---|
| **Business** | A tenant. One NDIS sole trader. All data is scoped by `businessId`. |
| **Participant / Client** | The NDIS participant receiving support. Stored in `Client`. Always has a 9-digit `ndisNumber`. |
| **Plan Manager** | The agency that pays invoices on behalf of a plan-managed participant. |
| **Shift** | One block of support work with a date, start time, end time and optional travel. |
| **Shift line item** | One claimable component of a shift (e.g. "weekday daytime 2.0h @ 67.56"). Stored in `ShiftLineItem`. |
| **Rate tier** | Which NDIS rate applies: `DAY`, `EVENING`, `SATURDAY`, `SUNDAY`, `HOLIDAY`, `TRAVEL`. |
| **Support item code** | The official NDIS item number, e.g. `01_011_0107_1_1`. |
| **NDIS cap** | The maximum price allowed by the price guide (stored in `NdisSupportItem`). |
| **Agreed rate** | The hourly rate the business agreed with the participant (`Client.hourlyRateAgreed`). |
| **Effective rate** | The rate actually billed: `min(agreed rate, NDIS cap)` — see Section 4.5. |
| **Uninvoiced shift** | A logged shift that has not yet been attached to an invoice (`isInvoiced = false`). |
| **Business timezone** | IANA timezone of the business (default `Australia/Sydney`), used for all tier decisions. |

---

## SECTION 4 — DOMAIN RULES (MONEY & RATES)

### 4.1 The 2026 NDIS rate tiers

| Tier | When it applies (business local time) | Support item code | Rate source column |
|---|---|---|---|
| `DAY` | Weekday (Mon–Fri) from 00:00 up to 20:00 | `01_011_0107_1_1` | `nationalWeekdayRate` |
| `EVENING` | Weekday (Mon–Fri) from 20:00 to midnight | `01_015_0107_1_1` | `nationalEveningRate` |
| `SATURDAY` | Any time on Saturday | `01_014_0107_1_1` | `nationalSaturdayRate` |
| `SUNDAY` | Any time on Sunday | `01_013_0107_1_1` | `nationalSundayRate` |
| `HOLIDAY` | Any time on a gazetted public holiday | `01_012_0107_1_1` | `nationalHolidayRate` |
| `TRAVEL` | Activity-based transport, per kilometre | `01_799_0107_1_1` | `nationalWeekdayRate` (unit = KM) |

### 4.2 Item codes are fixed — never invent or alter them

```
01_011_0107_1_1   Weekday daytime assistance
01_015_0107_1_1   Weekday evening assistance (after 20:00)
01_014_0107_1_1   Saturday assistance
01_013_0107_1_1   Sunday assistance
01_012_0107_1_1   Public holiday assistance
01_799_0107_1_1   Activity-based transport (per km)
```

All six already exist in the seeded `NdisSupportItem` catalogue. If any of them is missing at runtime, the request MUST fail with `500 SUPPORT_CATALOGUE_INCOMPLETE` (never fall back to a hardcoded number).

### 4.3 Priority order of tiers (this order is mandatory)

```
1. Public holiday  (highest priority — overrides everything)
2. Sunday
3. Saturday
4. Weekday  -> then split into DAY / EVENING at 20:00
5. Travel   (always added on top, independent of the time tiers)
```

### 4.4 Time boundaries (explicit, no interpretation allowed)

- The evening threshold is **20:00 exactly** in business local time.
- A shift that **ends at or before** 20:00 is billed 100% as `DAY`.
- A shift that **starts at or after** 20:00 is billed 100% as `EVENING`.
- A shift that **straddles** 20:00 is split into `DAY` (start → 20:00) and `EVENING` (20:00 → end).
- **Early morning rule (v1):** any weekday time between 00:00 and 06:00 is billed at the `DAY` rate. There is no separate "night" tier in v1. (06:00 in the price guide name refers to the standard daytime band; Rayvice v1 does not apply a different rate before 06:00.)
- **Midnight rule:** the tier is decided per calendar day segment. A shift crossing midnight is split into segments at 00:00 local, and each segment is rated using its own day's tier.

### 4.5 Effective rate rule (APPROVED DECISION)

```
NDIS cap        = rate from NdisSupportItem for (item code, tier)
agreed rate     = Client.hourlyRateAgreed (may be null)
effective rate  = agreed rate is null ? NDIS cap : min(agreed rate, NDIS cap)
```

**Reasoning:** the NDIS cap is a legal maximum — Rayvice must never bill above it (Module 5's shield would block it anyway). But if the business agreed a *lower* rate with the participant, the lower rate is what gets billed.

- The agreed rate is applied **only to time tiers** (`DAY`, `EVENING`, `SATURDAY`, `SUNDAY`, `HOLIDAY`). It is **never** applied to `TRAVEL` (travel is a per-km statutory rate).
- The applied rate for every line must be **snapshotted** onto the line item (Section 6.3) so historical shifts never change when the catalogue is updated next year.
- The response must expose both `ndisCapRate` and `appliedRate` per line for transparency in the UI.

### 4.6 Rounding rules (money must be reproducible)

1. Quantities (hours, km) are rounded to **2 decimals**, half-up.
2. Each line amount = `round2(quantity × rate)`.
3. Shift `grandTotal` = sum of the **already-rounded** line amounts (never round the sum again).
4. All stored money uses `Prisma.Decimal` with `@db.Decimal(10, 2)`.
5. Never compute money with JavaScript floats and never use `toFixed()` for stored values (`toFixed` is only acceptable for display strings in the frontend).

### 4.7 Worked examples (use these as test fixtures — numbers must match exactly)

**Example A — the specification example (weekday straddling 20:00 + travel)**
```
Date: Wednesday 2026-08-26 (weekday, not a holiday)
Start 18:00, End 21:30, travel 12 km
DAY       18:00-20:00 = 2.00 h x 67.56 = 135.12
EVENING   20:00-21:30 = 1.50 h x 74.42 = 111.63
TRAVEL    12 km       x 0.97        =  11.64
GRAND TOTAL                          = 258.39
```

**Example B — pure daytime weekday, no travel**
```
Tuesday 09:00-13:00 = 4.00 h x 67.56 = 270.24  (single DAY line)
```

**Example C — Saturday**
```
Saturday 10:00-14:30 = 4.50 h x 95.07 = 427.82  (single SATURDAY line)
```

**Example D — Sunday**
```
Sunday 08:00-12:00 = 4.00 h x 122.59 = 490.36   (single SUNDAY line)
```

**Example E — public holiday**
```
Friday 2026-12-25 (Christmas Day) 09:00-12:00 = 3.00 h x 150.12 = 450.36 (single HOLIDAY line)
```

**Example F — overnight shift crossing midnight (Friday into Saturday)**
```
Friday 2026-08-28 22:00 -> Saturday 2026-08-29 01:00
Segment 1 (Friday)   22:00-24:00 = 2.00 h -> weekday, starts after 20:00 -> EVENING 2.00 x 74.42 = 148.84
Segment 2 (Saturday) 00:00-01:00 = 1.00 h -> SATURDAY 1.00 x 95.07 = 95.07
GRAND TOTAL = 243.91
```

**Example G — overnight crossing into a public holiday**
```
Thursday 2026-12-24 23:00 -> Friday 2026-12-25 02:00 (Christmas Day is a holiday)
Segment 1 (Thursday) 23:00-24:00 = 1.00 h -> EVENING 1.00 x 74.42 = 74.42
Segment 2 (Friday)   00:00-02:00 = 2.00 h -> HOLIDAY 2.00 x 150.12 = 300.24
GRAND TOTAL = 374.66
```

**Example H — agreed rate below cap**
```
Client agreed rate = 60.00, weekday 09:00-11:00 = 2.00 h
cap 67.56 -> effective 60.00 -> 2.00 x 60.00 = 120.00
```

**Example I — agreed rate above cap (must be capped)**
```
Client agreed rate = 80.00, weekday 09:00-11:00 = 2.00 h
cap 67.56 -> effective 67.56 -> 2.00 x 67.56 = 135.12
```

---

## SECTION 5 — TIMEZONE, DAYLIGHT SAVING & PUBLIC HOLIDAYS

### 5.1 Why this section exists

Australia has three relevant timezones (AEST +10, ACST +9:30, AWST +8) and daylight saving applies in NSW, VIC, ACT, TAS and SA but **not** in QLD, NT or WA. Using UTC or server-local time to decide "is this a Saturday?" or "is this after 20:00?" will bill the **wrong rate** and produce rejected or underpaid invoices. This is a money-correctness issue, not a display detail.

### 5.2 Business timezone

- Add an additive field to `Business`: `timezone String @default("Australia/Sydney")`.
- Mapping used when creating/updating a business profile (based on `Business.state`):
  | State | Timezone |
  |---|---|
  | NSW, ACT, VIC, TAS | `Australia/Sydney` (VIC/TAS use `Australia/Melbourne` / `Australia/Hobart` if state is exact) |
  | QLD | `Australia/Brisbane` |
  | SA | `Australia/Adelaide` |
  | WA | `Australia/Perth` |
  | NT | `Australia/Darwin` |
  | null / unknown | `Australia/Sydney` (default) |
- Recommended mapping (exact): NSW→`Australia/Sydney`, VIC→`Australia/Melbourne`, QLD→`Australia/Brisbane`, SA→`Australia/Adelaide`, WA→`Australia/Perth`, TAS→`Australia/Hobart`, NT→`Australia/Darwin`, ACT→`Australia/Sydney`.
- Use the **luxon** library for every conversion. Never use `Date.getUTCDay()`, `getDay()`, or manual `+10:00` offsets.

### 5.3 How tier decisions must be made

Given `shiftDate` (`YYYY-MM-DD`), `startTime` (`HH:mm`), `endTime` (`HH:mm`) and the business timezone:

1. Build local `DateTime` objects: `DateTime.fromISO(`${shiftDate}T${startTime}`, { zone: businessTimezone })`.
2. If `endTime <= startTime`, the shift crosses midnight → the end `DateTime` is on the **next calendar day**.
3. Walk the shift in **contiguous segments**, splitting at:
   - `00:00` local of each new day, and
   - `20:00` local on weekdays.
4. For each segment, determine the tier using the **local calendar date** of the segment start (holiday > Sunday > Saturday > weekday day/evening).
5. Duration of a segment = the **absolute elapsed time** between its two local timestamps (this is what correctly handles DST).

### 5.4 Daylight saving handling (mandatory)

- **Duration** must always come from the absolute time difference (UTC instants), never from subtracting wall-clock numbers.
- **Tier** must always come from the local wall-clock time (so "after 20:00" means 20:00 on the local clock).
- DST transition examples that MUST be handled:
  - **Clocks forward (e.g. NSW, first Sunday of October):** a 01:00 → 04:00 shift is **2.0 real hours** (the 02:00–03:00 hour does not exist locally).
  - **Clocks back (e.g. NSW, first Sunday of April):** a 01:00 → 04:00 shift is **4.0 real hours** (01:00–02:00 occurs twice).
- Non-existent local times (e.g. `02:30` on the spring-forward day) must be normalised forward using luxon's default behaviour; do not throw.

### 5.5 Public holiday detection (APPROVED DECISION)

Layered approach:

1. **Automatic detection:** use the **`date-holidays`** npm package (free, offline, no API key) initialised as `new Holidays('AU', business.state ?? 'NSW')`. A date is a public holiday if `isHoliday(date)` returns a non-empty result for that local date.
2. **Manual override:** the request may include `isPublicHoliday: true|false`.
   - If `isPublicHoliday === true` → treat as `HOLIDAY` regardless of the library.
   - If `isPublicHoliday === false` → treat as **not** a holiday (explicit business decision, e.g. a regional show day that the agency does not pay as a holiday).
   - If omitted → use the library result.
3. **Storage:** persist `isPublicHoliday` (boolean) and `publicHolidayName` (string, nullable) on the shift, and the rule source (`AUTO` | `MANUAL`) in the audit metadata.
4. **List/detail responses** must expose `isPublicHoliday` and `publicHolidayName` so the worker can see why the holiday rate was applied.

### 5.6 Shift date validity

- The shift date must be a real calendar date in the business timezone.
- The shift date may be **today or in the past**, up to **90 days** back (backdating window).
- Future-dated shifts are rejected with `SHIFT_DATE_IN_FUTURE`.
- Shifts older than 90 days are rejected with `SHIFT_DATE_TOO_OLD`.
- The 90-day value is a constant `MAX_BACKDATE_DAYS = 90` in the engine config (not an env var) — changing it requires a spec change.

---

## SECTION 6 — DATA MODEL CHANGES (PRISMA)

All changes in this section are **additive**. No existing column is renamed, retyped or dropped, and no existing row is modified by the migration.

### 6.1 New / extended enums

```prisma
enum ShiftStatus {
  PENDING      // logged, not yet invoiced (default)
  INVOICED     // attached to an invoice — immutable
  CANCELLED    // voided by the worker (kept for audit)
}

enum PlanTier {
  TRIAL        // 9-day free trial (default)
  STARTER      // $24 AUD / month
  PRO          // $44 AUD / month (voice AI unlocked)
}

/// Extended (additive) — existing values keep their meaning
enum AuditAction {
  // ... existing values unchanged ...
  SHIFT_LOGGED
  SHIFT_UPDATED
  SHIFT_DELETED
  SHIFT_VOICE_PARSED
}

enum RateTier {
  DAY
  EVENING
  SATURDAY
  SUNDAY
  HOLIDAY
  TRAVEL
}

enum RateSource {
  AUTO          // holiday detected by date-holidays
  MANUAL        // holiday decided by the worker's override flag
  NOT_HOLIDAY   // worker explicitly marked the day as not-a-holiday
}
```

### 6.2 `Shift` model — additions

Add to the existing `Shift` model (existing fields stay exactly as they are):

| Field | Type | Notes |
|---|---|---|
| `status` | `ShiftStatus @default(PENDING)` | Replaces `isInvoiced` as the primary state; `isInvoiced` is kept for Module 5 compatibility and MUST be kept in sync (`status = INVOICED` ⇔ `isInvoiced = true`) |
| `startAt` | `DateTime?` | Absolute UTC instant of shift start (computed from local date/time + business timezone) |
| `endAt` | `DateTime?` | Absolute UTC instant of shift end (may be the next day) |
| `timezoneUsed` | `String?` | IANA zone used for the calculation (audit evidence) |
| `totalAmount` | `Decimal? @db.Decimal(10, 2)` | Sum of rounded line amounts (list/dashboard read optimisation) |
| `hourlyRateApplied` | `Decimal? @db.Decimal(10, 2)` | Convenience value for the frontend (effective time rate) |
| `isPublicHoliday` | `Boolean @default(false)` | Whether the shift was billed as a holiday |
| `publicHolidayName` | `String?` | e.g. "Christmas Day" |
| `holidaySource` | `RateSource?` | AUTO / MANUAL / NOT_HOLIDAY |
| `calculatedAt` | `DateTime?` | When the split was last computed |
| `idempotencyKey` | `String?` | Client-supplied double-submit guard, unique per business |
| `cancelledAt` | `DateTime?` | When the shift was cancelled (delete = cancel, see Section 12.5) |

Additive indexes and constraints:

```prisma
@@unique([businessId, idempotencyKey])
@@index([businessId, status])
@@index([businessId, shiftDate])
@@index([userId, startAt])
```

`userId` and `clientId` keep `onDelete: Cascade` as they are today. `invoiceId` keeps `onDelete: SetNull`.

### 6.3 New model — `ShiftLineItem` (mandatory)

This table is **required**: without it the split is not reproducible, and Module 5 cannot build invoice line items.

```prisma
model ShiftLineItem {
  id               String   @id @default(uuid())
  shiftId          String   @map("shift_id")
  businessId       String   @map("business_id")   // tenant scope, always set
  rateTier         RateTier @map("rate_tier")
  supportItemCode  String   @map("support_item_code")
  description      String
  quantity         Decimal  @db.Decimal(10, 2)    // hours or kilometres
  unit             String   @default("Hour")      // "Hour" | "KM"
  ndisCapRate      Decimal  @map("ndis_cap_rate") @db.Decimal(10, 2)
  appliedRate      Decimal  @map("applied_rate")  @db.Decimal(10, 2) // snapshot — never recomputed later
  amount           Decimal  @db.Decimal(10, 2)
  segmentStart     DateTime? @map("segment_start") // UTC instant, null for TRAVEL
  segmentEnd       DateTime? @map("segment_end")
  sortOrder        Int      @default(0) @map("sort_order")

  createdAt        DateTime @default(now()) @map("created_at")

  shift            Shift    @relation(fields: [shiftId], references: [id], onDelete: Cascade)

  @@index([shiftId])
  @@index([businessId])
  @@map("shift_line_items")
}
```

**Why `appliedRate` is snapshotted:** the NDIS price guide is re-published every year. If a 2026 shift is re-opened in 2027, it must still show the 2026 amounts. Live lookups would silently rewrite history and break audit and tax reproducibility.

### 6.4 Additive changes to existing models (complete list — nothing else is permitted)

| File | Change | Reason |
|---|---|---|
| `prisma/schema.prisma` | `Business.timezone` (default `Australia/Sydney`) | Correct rate tiers |
| `prisma/schema.prisma` | `Business.planTier PlanTier @default(TRIAL)` | Voice AI gating (Starter vs Pro); Module 5 will update it on subscription |
| `prisma/schema.prisma` | `Shift` additions from 6.2 | Engine output + state |
| `prisma/schema.prisma` | `ShiftLineItem` model | Reproducible split |
| `prisma/schema.prisma` | `AuditAction`, `ShiftStatus`, `PlanTier`, `RateTier`, `RateSource` enums | New states |
| `src/business/trial.util.ts` | accept `'voice'` as a resource type using existing `TRIAL_LIMITS.MAX_VOICE_TRANSCRIPTIONS` | Trial voice cap (3) |
| `src/business/business.service.ts` | set `timezone` from `state` on profile create/update | Section 5.2 |
| `src/clients/client.service.ts` | extract a reusable `recalculateClientBudgetSpent(clientId, businessId)` helper (exported) and call it after shift create/update/delete | Budget tracking (Section 9) |
| `src/app.ts` | mount `/api/v1/shifts`, `/api/v1/dashboard` (and `/api/...` aliases) | Routing convention already used by Modules 1–3 |

**Explicitly forbidden:** changing auth, JWT, cookies, rate limiters, existing client endpoints, invoice models, or the error envelope format.

### 6.5 Migration notes

- One migration adds the enums, the `ShiftLineItem` table, and the new nullable columns. Because all new `Shift` columns are nullable or defaulted, the migration is safe on existing rows.
- Backfill rule for existing shifts (if any exist): set `status = PENDING`, `isInvoiced` unchanged, `totalAmount = null`, no line items. **Do not** attempt to recompute historical shifts — there is no trustworthy stored rate snapshot for them.
- `shift_line_items.business_id` must always be populated from `req.user.businessId` on insert.

---

## SECTION 7 — CALCULATION ENGINE SPECIFICATION (`src/shifts/shift.engine.ts`)

### 7.1 Design constraints

- **Pure function.** No database access, no network, no `Date.now()` inside the core walk. Rates and holiday facts are passed in as arguments. This makes it 100% unit-testable.
- **Deterministic.** Same input → same output, always.
- **Single source of truth.** The API response, the stored line items, and the frontend preview must all be derived from this one engine's output. The frontend re-implements only a mirror for instant preview; on save, the backend result is authoritative and overwrites the preview.

### 7.2 Input contract

```ts
export interface ShiftCalculationInput {
  date: string;             // "YYYY-MM-DD" (business local calendar date of shift start)
  startTime: string;        // "HH:mm" 24-hour, business local time
  endTime: string;          // "HH:mm" 24-hour, business local time
  travelKms?: number;       // optional, >= 0, max 500
  timezone: string;         // IANA, e.g. "Australia/Sydney"
  isPublicHoliday?: boolean | null; // null/undefined = auto-detect
}

export interface RateTable {
  day:      { itemCode: string; cap: Prisma.Decimal };
  evening:  { itemCode: string; cap: Prisma.Decimal };
  saturday: { itemCode: string; cap: Prisma.Decimal };
  sunday:   { itemCode: string; cap: Prisma.Decimal };
  holiday:  { itemCode: string; cap: Prisma.Decimal };
  travel:   { itemCode: string; cap: Prisma.Decimal; unit: 'KM' };
  agreedRate: Prisma.Decimal | null; // Client.hourlyRateAgreed
  travelAllowed: boolean;            // NdisSupportItem.isTravelAllowed for the chosen item
}

export interface CalculatedLine {
  rateTier: RateTier;
  supportItemCode: string;
  description: string;
  quantity: Prisma.Decimal;
  unit: 'Hour' | 'KM';
  ndisCapRate: Prisma.Decimal;
  appliedRate: Prisma.Decimal;
  amount: Prisma.Decimal;
  segmentStart: Date | null;
  segmentEnd: Date | null;
  sortOrder: number;
}

export interface ShiftCalculationResult {
  lines: CalculatedLine[];
  totalHours: Prisma.Decimal;
  travelKms: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
  isPublicHoliday: boolean;
  publicHolidayName: string | null;
  holidaySource: 'AUTO' | 'MANUAL' | 'NOT_HOLIDAY';
  startAt: Date;
  endAt: Date;
  timezoneUsed: string;
}
```

### 7.3 Algorithm (implement exactly in this order)

1. **Validate** date/time formats; if `startTime === endTime` → `SHIFT_DURATION_INVALID`.
2. Build `startLocal = DateTime.fromISO(date + "T" + startTime, { zone: timezone })`. If invalid → `SHIFT_DATE_INVALID`.
3. Build `endLocal`: same calendar date + `endTime`; if `endTime <= startTime`, add **1 day** (overnight).
4. Compute `durationMinutes = endLocal.toUTC() - startLocal.toUTC()` (absolute). If `<= 0` → `SHIFT_DURATION_INVALID`.
5. Guard rails: if `durationMinutes > 960` (16 h) → `SHIFT_DURATION_TOO_LONG`. If `> 720` (12 h) → include a `warnings[]` entry `LONG_SHIFT_WARNING` (still save).
6. **Holiday resolution:** apply Section 5.5 (auto via `date-holidays` for the *local date of each segment* or manual override). Because a shift can cross into a new day, holiday status is resolved **per segment date**, not once for the whole shift.
7. **Segment walk** (this is the core loop):
   - `cursor = startLocal`
   - While `cursor < endLocal`:
     a. `dayEnd = cursor.startOf('day').plus({ days: 1 })`
     b. `next = min(endLocal, dayEnd)`
     c. If the segment's local date is a weekday (Mon–Fri) **and** `cursor < 20:00 local of that day` **and** `next > 20:00 local of that day` → first split at `20:00`: emit `[cursor, 20:00)` then set `cursor = 20:00`.
     d. Determine the tier of the current segment from its **local start date**: holiday → `HOLIDAY`; else Sunday → `SUNDAY`; else Saturday → `SATURDAY`; else (weekday) → `cursor.localHour >= 20` ? `EVENING` : `DAY`.
     e. Emit one line for `[cursor, next)` with:
        - `quantity = round2(absoluteMinutes / 60)`
        - `ndisCapRate = rateTable[tier].cap`
        - `appliedRate = tier === 'TRAVEL' ? cap : (agreedRate === null ? cap : min(agreedRate, cap))`
        - `amount = round2(quantity × appliedRate)`
        - `description` from the templates in 7.4
        - `segmentStart/segmentEnd` as UTC instants
     f. `cursor = next`
   - **Merge rule:** consecutive emitted lines with the *same* tier, item code and applied rate **must be merged** into one line (this prevents a shift crossing midnight from producing two identical `SATURDAY` lines when neither part is a weekday).
8. **Travel:** if `travelKms > 0`:
   - If `travelAllowed === false` → error `TRAVEL_NOT_ALLOWED_FOR_ITEM`.
   - If `travelKms > 500` → error `TRAVEL_KM_INVALID`.
   - Append a `TRAVEL` line: `quantity = round2(travelKms)`, `appliedRate = travel cap` (never the agreed rate), `unit = 'KM'`, `segmentStart/End = null`.
9. `totalHours = sum of all Hour-tier quantities` (rounded 2dp). Travel km are **not** included in `totalHours`.
10. `grandTotal = sum of every line's already-rounded amount`.
11. Return the result with `sortOrder` 0..n in emission order.

### 7.4 Description templates (use verbatim)

```
DAY:      "Weekday Daytime Support (HH:mm - HH:mm)"
EVENING:  "Weekday Evening Support (HH:mm - HH:mm)"
SATURDAY: "Saturday Support (HH:mm - HH:mm)"
SUNDAY:   "Sunday Support (HH:mm - HH:mm)"
HOLIDAY:  "Public Holiday Support (HH:mm - HH:mm)"
TRAVEL:   "Activity-Based Transport (N km @ $R/km)"
```
Where `HH:mm` values are local times and `R` is the applied travel rate. For overnight segments the end time may be `24:00` for the first segment (display convention) — the stored `segmentEnd` remains the true instant.

### 7.5 Engine errors (thrown as typed engine errors, mapped to API errors in Section 12)

| Engine error code | Meaning |
|---|---|
| `SHIFT_TIME_FORMAT_INVALID` | `startTime`/`endTime` not `HH:mm` |
| `SHIFT_DATE_INVALID` | date not a real `YYYY-MM-DD` |
| `SHIFT_DURATION_INVALID` | end equals start, or non-positive duration |
| `SHIFT_DURATION_TOO_LONG` | duration > 16 h |
| `TRAVEL_KM_INVALID` | travelKms < 0, > 500, or not a number |
| `TRAVEL_NOT_ALLOWED_FOR_ITEM` | travel claimed for a support item that forbids travel |
| `SUPPORT_CATALOGUE_INCOMPLETE` | one of the six required catalogue rows is missing |

### 7.6 Engine test matrix (must exist in `tests/shift.engine.test.ts`)

| # | Case | Expected |
|---|---|---|
| 1 | Weekday 09:00–13:00 | 1 DAY line 4.00 h = 270.24 |
| 2 | Weekday 18:00–21:30 + 12 km (Example A) | DAY 2.00 = 135.12, EVENING 1.50 = 111.63, TRAVEL 11.64, total 258.39 |
| 3 | Weekday 20:00–22:00 | single EVENING 2.00 h |
| 4 | Weekday 19:59–20:01 | DAY 0.02 h + EVENING 0.02 h (boundary split) |
| 5 | Saturday 10:00–14:30 | single SATURDAY 4.50 h |
| 6 | Sunday 08:00–12:00 | single SUNDAY 4.00 h |
| 7 | Public holiday (auto) weekday | single HOLIDAY line |
| 8 | Public holiday manual override on a normal weekday | single HOLIDAY line, `holidaySource = MANUAL` |
| 9 | Manual "not a holiday" on an actual holiday | weekday/weekend rate, `holidaySource = NOT_HOLIDAY` |
| 10 | Friday 22:00 → Saturday 01:00 (Example F) | EVENING 2.00 + SATURDAY 1.00 = 243.91 |
| 11 | Thursday 23:00 → Friday 02:00 where Friday is a holiday (Example G) | EVENING 1.00 + HOLIDAY 2.00 = 374.66 |
| 12 | Overnight where both days are Saturday/Sunday | merged single line per tier |
| 13 | Agreed rate 60 (< cap) | applied 60.00 |
| 14 | Agreed rate 80 (> cap) | applied 67.56 |
| 15 | Travel with agreed rate set | travel still billed at statutory km rate |
| 16 | `travelAllowed = false` + km > 0 | throws `TRAVEL_NOT_ALLOWED_FOR_ITEM` |
| 17 | 17 h shift | throws `SHIFT_DURATION_TOO_LONG` |
| 18 | 13 h shift | succeeds + `LONG_SHIFT_WARNING` |
| 19 | DST spring-forward (NSW, 01:00→04:00) | 2.00 h total |
| 20 | DST fall-back (NSW, 01:00→04:00) | 4.00 h total |
| 21 | Missing catalogue row | throws `SUPPORT_CATALOGUE_INCOMPLETE` |
| 22 | Travel 0 or omitted | no TRAVEL line |

---

## SECTION 8 — DECISIONS LOG (APPROVED — DO NOT RE-LITIGATE)

| # | Decision | Chosen behaviour | Reason |
|---|---|---|---|
| D1 | Shift editing | **Allowed while `status = PENDING`**; forbidden once invoiced | A 5-minute typo should not force delete + re-create |
| D2 | Budget overrun | **Warn, never block** | Blocking would stop a worker mid-shift from recording real work; the warning plus the invoice shield is sufficient protection |
| D3 | Sleepover / night-work flat item | **Deferred to v2** | Needs the official NDIS item code + rate; a guessed code causes invoice rejection |
| D4 | Rate source | **Database catalogue, never hardcoded** | Price guide changes yearly; catalogue is the single source of truth |
| D5 | Agreed rate vs cap | `effective = min(agreed, cap)` | Cap is a legal maximum; agreed rate may be lower |
| D6 | Early-morning hours | 00:00–06:00 billed at `DAY` rate | No separate tier defined in v1; matches the supplied engine behaviour |
| D7 | Overnight shifts | Split at local midnight; tier per day | Correct NDIS rating across day boundaries |
| D8 | Timezone | Business timezone (default `Australia/Sydney`), luxon, DST-aware | Using UTC bills the wrong tier in Australia |
| D9 | Public holidays | `date-holidays` (state-based) + manual override | Free, offline, handles substitute days; override covers regional exceptions |
| D10 | Voice AI plan gating | Pro only; trial gets 3 parses | Matches the published plan matrix (Starter = manual logging) |
| D11 | Voice audio retention | Never stored | Privacy-by-design for NDIS participant data |
| D12 | AI output | Preview only; worker confirms | A wrong AI number becomes a rejected invoice |
| D13 | Participant identity to AI | First name only | Provider free tiers may use data for training; NDIS data is sensitive |
| D14 | Delete behaviour | Soft cancel (`status = CANCELLED` + `cancelledAt`), never a hard delete | Preserves audit trail |
| D15 | Invoice immutability | Invoiced shifts cannot be edited or deleted | Tax invoice line items must stay reproducible |
| D16 | Rate snapshot | `appliedRate` + `ndisCapRate` stored per line | Historical reproducibility across price-guide years |
| D17 | Dashboard data | New `GET /dashboard/summary` endpoint | Six widgets must not cause six round trips |
| D18 | Budget update timing | On shift create/update/cancel, via a client-service recompute helper | The worker sees the real remaining budget immediately |
| D19 | Double-submit | Optional `Idempotency-Key` header, unique per business | Prevents duplicate shifts from double taps / flaky mobile networks |
| D20 | Client change on edit | **Not allowed** | Prevents cross-participant budget corruption; delete + re-create instead |

---

## SECTION 9 — BUDGET TRACKING INTEGRATION (MODULE 3 LINK)

### 9.1 Rule

- `Client.allocatedBudgetSpent` = the sum of `grandTotal` of that client's **non-cancelled** shifts (`status IN (PENDING, INVOICED)`), regardless of whether they are invoiced yet.
- The value is **recomputed** (not incremented) whenever a shift is created, edited, or cancelled for that client. Recomputation is idempotent and immune to drift.

### 9.2 Implementation contract

```ts
// exported from src/clients/client.service.ts (additive helper)
export async function recalculateClientBudgetSpent(clientId: string, businessId: string): Promise<Prisma.Decimal>
```

- Implementation: `prisma.shift.aggregate({ where: { businessId, clientId, status: { not: 'CANCELLED' } }, _sum: { totalAmount: true } })`, defaulting to `0.00`.
- MUST run inside the same logical operation as the shift write (call it immediately after the shift transaction commits; do not wrap it in a separate un-awaited promise).
- If the client has no `allocatedBudgetTotal`, the spend is still recorded (it is informational).

### 9.3 Warning thresholds (returned to the frontend, never blocking)

| Utilisation | Level | Frontend tone |
|---|---|---|
| `< 70%` | `OK` | neutral |
| `>= 70%` and `< 100%` | `WARNING` | amber (`#F59E0B`) |
| `>= 100%` | `EXHAUSTED` | red (`#EF4444`) |

- Every shift create/update response includes `budget: { allocatedTotal, allocatedSpent, utilizationPercent, level }`.
- When `level = EXHAUSTED`, the request still succeeds (`201`/`200`) but the response carries `warnings: ['BUDGET_EXHAUSTED']`. The frontend shows the warning; the backend never blocks (decision D2).

---

## SECTION 10 — PLAN GATING & TRIAL LIMITS

### 10.1 Plan matrix (authoritative)

| Capability | Trial (`planTier = TRIAL`) | Starter | Pro |
|---|---|---|---|
| Manual shift logging | max **5 shifts** total | unlimited | unlimited |
| Voice AI parsing | max **3 parses** total | ❌ blocked | unlimited |
| Participants | max 1 active | up to 5 | unlimited |
| Invoices | max 2 | 20 / month | unlimited |

Source of truth for these numbers: `src/business/trial.util.ts` → `TRIAL_LIMITS` (already contains `MAX_CLIENTS: 1`, `MAX_SHIFTS: 5`, `MAX_INVOICES: 2`, `MAX_VOICE_TRANSCRIPTIONS: 3`).

### 10.2 Enforcement points

| Endpoint | Check |
|---|---|
| `POST /shifts` | `assertCanMutate(businessId)` then `checkTrialResourceLimit(businessId, 'shifts')` |
| `POST /shifts/voice-parse` | `assertCanMutate(businessId)`; if `planTier === TRIAL` → `checkTrialResourceLimit(businessId, 'voice')`; else require `planTier === PRO` |
| `PATCH /shifts/:id` | `assertCanMutate(businessId)` (no new shift created, so no shift-count check) |

### 10.3 Trial resource type extension (additive)

`checkTrialResourceLimit` must accept `'voice'` alongside `'clients' | 'shifts' | 'invoices'`:

```ts
// inside the TRIALING branch
} else if (resourceType === 'voice') {
  const usage = await prisma.auditLog.count({
    where: { businessId, action: 'SHIFT_VOICE_PARSED' },
  });
  if (usage >= TRIAL_LIMITS.MAX_VOICE_TRANSCRIPTIONS) {
    throw ApiError.forbidden(
      `Free trial is limited to ${TRIAL_LIMITS.MAX_VOICE_TRANSCRIPTIONS} voice transcriptions. Upgrade to Pro for unlimited voice AI.`,
      'TRIAL_VOICE_LIMIT_REACHED'
    );
  }
}
```

Counting voice usage from the audit log guarantees it cannot be reset by deleting shifts.

### 10.4 Error codes

| Situation | HTTP | `errorCode` |
|---|---|---|
| Trial shift cap reached | 403 | `TRIAL_SHIFT_LIMIT_REACHED` (already used by Module 3 pattern `TRIAL_CLIENT_LIMIT_REACHED`) |
| Trial voice cap reached | 403 | `TRIAL_VOICE_LIMIT_REACHED` |
| Starter plan attempts voice | 403 | `VOICE_PLAN_REQUIRED` |
| Trial expired / read-only | 402 | `TRIAL_EXPIRED` (existing) |

---

## SECTION 11 — VOICE AI PIPELINE (`src/shifts/voice-parser.ts`)

### 11.1 Purpose

Let a support worker log a shift hands-free from their car. The worker speaks naturally; the backend transcribes and structures it, and returns a **preview** that the worker confirms in the normal shift form.

### 11.2 End-to-end flow

```
[Frontend] record audio (max 60 s)
      ↓  multipart/form-data: file=<audio>, timezone=<IANA>
[POST /shifts/voice-parse]  (auth + plan/trial gate + rate limit)
      ↓  buffer in memory (never written to disk)
[Groq Whisper]  model: whisper-large-v3  → plain transcript (English)
      ↓
[Gemini Flash]  structured JSON output, temperature 0
      ↓  validate with Zod against VoiceParseSchema
[Post-processing on OUR server]  match client by first name → attach clientId (or `clientCandidates[]`)
      ↓
[Response]  preview object (NOT saved)
      ↓
[Frontend] prefills ShiftModal → worker reviews → POST /shifts (or PATCH)
```

### 11.3 Audio upload contract

| Item | Rule |
|---|---|
| Field name | `file` |
| Transport | `multipart/form-data` (never base64 in JSON) |
| Parser | `multer` with `memoryStorage()` only |
| Max size | **5 MB** → `413 VOICE_FILE_TOO_LARGE` |
| Max duration | **60 s** (enforced server-side by inspecting the container duration; if it cannot be determined, rely on the size cap) → `422 VOICE_AUDIO_TOO_LONG` |
| Accepted MIME types | `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-m4a`, `audio/aac` → otherwise `415 INVALID_AUDIO_FORMAT` |
| Retention | **Zero.** The buffer is discarded as soon as the request completes. No temp files, no object storage, no logging of audio content |
| Rate limit | 10 requests / minute / user, 30 requests / day / user (in addition to global limiter) |

### 11.4 Step 1 — Groq Whisper transcription

- Endpoint: `POST https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3`
- Parameters: `language: "en"`, `response_format: "json"`, `temperature: 0`
- Auth: `Authorization: Bearer ${env.GROQ_API_KEY}`
- Timeout: 20 s → `504 VOICE_TRANSCRIPTION_FAILED`
- Empty/garbled transcript (< 3 words) → `422 VOICE_TRANSCRIPT_UNUSABLE`
- The transcript must **never** be written to the database or logs (only its structured result may be audited).

### 11.5 Step 2 — Gemini structured extraction

- Endpoint: Gemini `generateContent` with **JSON response schema enforced** and `temperature: 0`.
- Auth: `x-goog-api-key: ${env.GEMINI_API_KEY}` (or `?key=` — follow the provider's current documented header).
- Timeout: 20 s → `504 VOICE_PARSE_FAILED`.
- The prompt MUST:
  - instruct the model to output **only** the JSON object matching the schema,
  - resolve relative dates ("today", "yesterday", "last Friday") against the supplied `currentDate` and `timezone`,
  - normalise times to 24-hour `HH:mm`,
  - return `null` for values it cannot determine (never invent numbers).
- Required output schema:

```json
{
  "clientFirstName": "Sarah",
  "shiftDate": "2026-08-31",
  "startTime": "18:00",
  "endTime": "21:30",
  "travelKms": 12,
  "caseNotes": "Community access to local pool and evening meal preparation.",
  "confidence": 0.0,
  "missingFields": ["endTime"]
}
```

Rules: `travelKms` numeric or `null`; `confidence` 0–1; `missingFields` lists any field the model could not determine; `caseNotes` is a short professional summary, max 1000 characters, and must not contain the participant's surname or NDIS number.

### 11.6 Privacy rules (MANDATORY)

1. The audio never leaves the process except to the transcription provider for the single request.
2. Do **not** send the participant's surname, NDIS number, address, date of birth or any identifier to either provider.
3. The Gemini prompt must state: *"Do not include any surnames, NDIS numbers, addresses, or dates of birth in the output."*
4. If the transcript contains an NDIS-number-like 9-digit sequence, strip it before sending the transcript to Gemini and add `ndisNumberRedacted: true` to the audit metadata.
5. `caseNotes` returned to the client must be run through the same redaction filter (9-digit sequences removed).
6. The frontend must display a one-line consent notice the first time the mic is used: *"Voice is processed by AI to fill the form. Review before saving."*

### 11.7 Step 3 — Server-side client matching (no AI involved)

- Take `clientFirstName`, then match against the business's **active, non-deleted** clients:
  1. exact case-insensitive match on the first word of `participantName`
  2. else prefix match
  3. else `null`
- Response always includes `clientCandidates`: up to 5 `{ id, participantName, ndisNumber }` for the UI dropdown; `matchedClientId` is set only for a unique exact match.
- **Never** let AI return or receive `clientId`.

### 11.8 Response contract

```json
{
  "success": true,
  "message": "Voice shift parsed successfully. Review before saving.",
  "data": {
    "transcriptPreview": "Worked with Sarah today from 6pm to 9:30pm, drove 12 kilometers…",
    "parsed": {
      "clientFirstName": "Sarah",
      "shiftDate": "2026-08-31",
      "startTime": "18:00",
      "endTime": "21:30",
      "travelKms": 12,
      "caseNotes": "Community access and evening meal preparation.",
      "confidence": 0.86,
      "missingFields": []
    },
    "matchedClientId": "uuid-or-null",
    "clientCandidates": [{ "id": "uuid", "participantName": "Sarah Jenkins", "ndisNumber": "430123456" }],
    "ndisNumberRedacted": false,
    "usage": { "voiceParsesUsed": 1, "voiceParsesLimit": 3, "planTier": "TRIAL" }
  }
}
```

- `transcriptPreview` is **truncated to 300 characters** and returned only for the current request (never stored).
- The response MUST NOT contain any save side effect. No shift row is created here.

### 11.9 Failure behaviour (graceful degradation)

| Failure | Behaviour |
|---|---|
| Groq/Gemini timeout or 5xx | `504` with a clear message; the frontend opens the empty manual form and shows a toast: *"Voice unavailable — please enter the shift manually."* |
| Low confidence (`confidence < 0.5`) | Return `200` with `parsed`, plus `warnings: ['LOW_CONFIDENCE']`; the UI highlights fields for review |
| Missing required fields | `200` with `missingFields` populated; the UI focuses the first missing field |
| No clients exist for the business | `200` with `clientCandidates: []` and a warning `NO_PARTICIPANTS` (the worker must add a participant first) |

---

## SECTION 12 — API CONTRACTS

Base paths: `/api/v1/shifts`, `/api/v1/dashboard` (the existing app also mounts `/api/...` aliases — keep both).

Every response uses the existing envelope:

```json
{ "success": true, "message": "...", "data": { } }
```
Errors use the existing error envelope (already produced by `errorHandler`):
```json
{ "success": false, "message": "...", "errorCode": "SOME_CODE", "errors": { "field": ["msg"] }, "details": { } }
```

All endpoints require `Authorization: Bearer <accessToken>` (`authenticate` middleware).

### 12.1 `POST /shifts` — log a shift

**Roles:** OWNER, OFFICE_MANAGER, TECHNICIAN

**Headers (optional):** `Idempotency-Key: <uuid>` — if a shift already exists for this business with the same key, return that shift with `200` instead of creating a duplicate.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `clientId` | uuid | yes | must belong to the business, must be active and not deleted |
| `shiftDate` | `YYYY-MM-DD` | yes | not in the future; not older than 90 days |
| `startTime` | `HH:mm` | yes | 24-hour |
| `endTime` | `HH:mm` | yes | may be earlier than `startTime` (overnight) |
| `travelKms` | number | no | 0–500, max 2 decimals |
| `caseNotes` | string | no | max 2000 chars |
| `isPublicHoliday` | boolean \| null | no | `null`/omitted = auto-detect |
| `supportItemCode` | string | no | defaults to `Client.defaultSupportItemCode`; if that is null, defaults to `01_011_0107_1_1` |
| `timezone` | string | no | defaults to `Business.timezone`; **ignored** if it differs from the business timezone (server always uses the business timezone) |

**Server behaviour (ordered)**

1. `assertCanMutate(businessId)`
2. `checkTrialResourceLimit(businessId, 'shifts')`
3. Validate client ownership/active status → `404 CLIENT_NOT_FOUND` / `422 CLIENT_INACTIVE`
4. Load the rate table from `NdisSupportItem` for the six required codes → `500 SUPPORT_CATALOGUE_INCOMPLETE` if any missing
5. Resolve the effective support item (request value or client default) → `422 INVALID_SUPPORT_ITEM` if it does not exist or is expired (`effectiveTo` in the past)
6. **Overlap check:** reject if this worker already has a non-cancelled shift whose `[startAt, endAt)` overlaps → `409 SHIFT_OVERLAP` (include the conflicting shift id in `details`)
7. **Duplicate check:** reject if the same worker + client + `startAt` already exists (non-cancelled) → `409 DUPLICATE_SHIFT`
8. Run the engine (Section 7) → lines + totals
9. `prisma.$transaction`: create `Shift`, create all `ShiftLineItem` rows
10. `recalculateClientBudgetSpent(clientId, businessId)`
11. `recordAuditEvent({ action: 'SHIFT_LOGGED', metadata: { shiftId, clientId, totalAmount, tiers, holidaySource, hasTravel, voiceAssisted } })`
12. Respond `201`

**Response `data`** — see Section 21.1 (ShiftView). Include:

```json
{
  "shift": { "...ShiftView..." },
  "budget": { "allocatedTotal": 15000.00, "allocatedSpent": 258.39, "utilizationPercent": 1.72, "level": "OK" },
  "warnings": []
}
```

**Errors:** 400 invalid payload (`VALIDATION_ERROR` / 422), 402 `TRIAL_EXPIRED`, 403 `TRIAL_SHIFT_LIMIT_REACHED`, 404 `CLIENT_NOT_FOUND`, 409 `SHIFT_OVERLAP` / `DUPLICATE_SHIFT`, 422 `SHIFT_DATE_IN_FUTURE` / `SHIFT_DATE_TOO_OLD` / `SHIFT_DURATION_TOO_LONG` / `TRAVEL_KM_INVALID` / `TRAVEL_NOT_ALLOWED_FOR_ITEM` / `INVALID_SUPPORT_ITEM` / `SHIFT_DURATION_INVALID`.

### 12.2 `GET /shifts` — list & filter

**Roles:** all authenticated roles (see Section 13 for visibility scoping)

**Query parameters**

| Param | Type | Default | Notes |
|---|---|---|---|
| `page` | int ≥ 1 | 1 | existing pagination util |
| `pageSize` | int 1–100 | 20 | existing pagination util |
| `from` | `YYYY-MM-DD` | — | inclusive, by `shiftDate` |
| `to` | `YYYY-MM-DD` | — | inclusive |
| `clientId` | uuid | — | filter by participant |
| `userId` | uuid | — | OWNER/OFFICE_MANAGER only; TECHNICIAN may only use their own id |
| `status` | `PENDING` \| `INVOICED` \| `CANCELLED` | — | |
| `isInvoiced` | boolean | — | convenience filter kept for Module 5 |
| `sort` | `shiftDate` \| `createdAt` \| `totalAmount` | `shiftDate` | |
| `order` | `asc` \| `desc` | `desc` | |

**Response `data`**

```json
{
  "items": [ { "...ShiftView..." } ],
  "pagination": { "page": 1, "pageSize": 20, "totalRecords": 42, "totalPages": 3 },
  "summary": { "totalAmount": 4820.55, "totalHours": 61.25, "count": 42 }
}
```
`summary` is computed over the **whole filtered set** (not just the current page).

### 12.3 `GET /shifts/:id` — detail

**Roles:** OWNER, OFFICE_MANAGER (any shift in tenant); TECHNICIAN (own shifts only → `403 FORBIDDEN` otherwise)

**Response `data`:** `{ shift: { ...ShiftView with lineItems populated... } }`

**Errors:** 404 `SHIFT_NOT_FOUND`, 403 `FORBIDDEN`

### 12.4 `PATCH /shifts/:id` — edit (decision D1)

**Roles:** OWNER, OFFICE_MANAGER (any shift); TECHNICIAN (own shifts only)

**Editable fields:** `shiftDate`, `startTime`, `endTime`, `travelKms`, `caseNotes`, `isPublicHoliday`, `supportItemCode`
**Immutable fields:** `clientId` (decision D20), `userId`, `id`, `createdAt`

**Behaviour**

1. Load shift scoped by `businessId`; `404 SHIFT_NOT_FOUND` if missing
2. If `status = INVOICED` or `isInvoiced = true` → `409 SHIFT_ALREADY_INVOICED`
3. If `status = CANCELLED` → `409 SHIFT_CANCELLED`
4. `assertCanMutate(businessId)`
5. Re-run overlap/duplicate checks (excluding this shift itself)
6. Re-run the engine with the merged values → **delete and re-create** all `ShiftLineItem` rows inside one transaction
7. `recalculateClientBudgetSpent`
8. `recordAuditEvent({ action: 'SHIFT_UPDATED', metadata: { shiftId, changedFields: [...], oldTotalAmount, newTotalAmount } })`
9. `200` with the same response shape as create

**Errors:** as create, plus `409 SHIFT_ALREADY_INVOICED`, `409 SHIFT_CANCELLED`, `404 SHIFT_NOT_FOUND`

### 12.5 `DELETE /shifts/:id` — soft cancel (decision D14)

**Roles:** OWNER, OFFICE_MANAGER (any shift); TECHNICIAN (own shifts only)

**Behaviour**

1. Load scoped by `businessId` → `404 SHIFT_NOT_FOUND`
2. If `status = INVOICED` → `409 SHIFT_ALREADY_INVOICED`
3. If already `CANCELLED` → `200` idempotent success (no audit duplicate)
4. Set `status = CANCELLED`, `cancelledAt = now()` (**never** a hard delete; keep the row and its line items)
5. `recalculateClientBudgetSpent` (cancelled shifts are excluded)
6. `recordAuditEvent({ action: 'SHIFT_DELETED', metadata: { shiftId, clientId, cancelledTotalAmount } })`
7. `200` with `{ shiftId, status: 'CANCELLED' }`

### 12.6 `GET /shifts/uninvoiced` — for Module 5 batch invoicing

**Roles:** OWNER, OFFICE_MANAGER, TECHNICIAN (own shifts only)

**Query:** `clientId` (optional), `from`, `to` (optional)

**Response `data`** — grouped by participant, ready for batch selection:

```json
{
  "groups": [
    {
      "clientId": "uuid",
      "clientName": "Sarah Jenkins",
      "ndisNumber": "430123456",
      "planManagementType": "PLAN_MANAGED",
      "shiftCount": 4,
      "totalHours": 14.5,
      "totalTravelKms": 22,
      "totalAmount": 1042.18,
      "shifts": [ { "...ShiftView..." } ]
    }
  ],
  "grandTotal": 1042.18,
  "totalShifts": 4
}
```

Only shifts with `status = PENDING` are included. `CANCELLED` and `INVOICED` are always excluded.

### 12.7 `POST /shifts/voice-parse` — audio → structured preview

See Section 11 for the full pipeline. Contract summary:

| Item | Value |
|---|---|
| Content-Type | `multipart/form-data` |
| Fields | `file` (required), `timezone` (optional) |
| Auth | required |
| Plan gate | Pro, or Trial with parses remaining (3) |
| Response | Section 11.8 preview (never saves a shift) |
| Audit | `recordAuditEvent({ action: 'SHIFT_VOICE_PARSED', metadata: { matched: bool, confidence, missingFieldsCount, redacted: bool } })` — **no transcript, no audio** |
| Errors | 403 `VOICE_PLAN_REQUIRED` / `TRIAL_VOICE_LIMIT_REACHED`, 413 `VOICE_FILE_TOO_LARGE`, 415 `INVALID_AUDIO_FORMAT`, 422 `VOICE_AUDIO_TOO_LONG` / `VOICE_TRANSCRIPT_UNUSABLE`, 429 `RATE_LIMITED`, 504 `VOICE_TRANSCRIPTION_FAILED` / `VOICE_PARSE_FAILED` |

### 12.8 `GET /dashboard/summary` — dashboard widgets (decision D17)

**Roles:** all authenticated roles. For a TECHNICIAN the numbers reflect **their own** shifts only; for OWNER/OFFICE_MANAGER, the whole business.

**Query:** optional `timezone` override is ignored (business timezone is authoritative).

**Week definition:** Monday 00:00 → Sunday 23:59:59 in the **business timezone** (Australian convention). `lastWeek` is the immediately preceding Monday–Sunday window.

**Response `data`**

```json
{
  "thisWeek": {
    "earnings": 2450.20,
    "hours": 36.25,
    "shiftCount": 9,
    "previousWeekEarnings": 2149.30,
    "changePercent": 14.0
  },
  "uninvoiced": {
    "shiftCount": 5,
    "totalAmount": 1120.00
  },
  "activeParticipants": 6,
  "recentShifts": [ { "...ShiftView (max 5, newest first)..." } ],
  "budgetWatch": [
    {
      "clientId": "uuid",
      "participantName": "Sarah Jenkins",
      "allocatedTotal": 15000.00,
      "allocatedSpent": 11250.00,
      "utilizationPercent": 75.0,
      "level": "WARNING"
    }
  ],
  "trial": { "status": "TRIALING", "daysRemaining": 6, "shiftsUsed": 4, "shiftsLimit": 5 }
}
```

Rules:
- `earnings` = sum of `totalAmount` of non-cancelled shifts whose `shiftDate` falls in the window (invoiced or not).
- `changePercent` = `round1(((this - prev) / prev) * 100)`; if `previousWeekEarnings === 0` → return `null` (the UI shows "—" instead of a fake percentage).
- `budgetWatch` returns only clients with `allocatedBudgetTotal IS NOT NULL` and utilisation `>= 70%`, sorted by utilisation descending, maximum 10 rows.
- `activeParticipants` = count of clients with `isActive = true AND deletedAt IS NULL`.
- `trial` is `null` for non-trial businesses.

---

## SECTION 13 — PERMISSIONS MATRIX

| Endpoint | OWNER | OFFICE_MANAGER | TECHNICIAN | SUPER_ADMIN |
|---|---|---|---|---|
| `POST /shifts` | ✅ | ✅ | ✅ (own shifts) | ❌ (admin panel only) |
| `GET /shifts` | ✅ all | ✅ all | ✅ own only | ❌ |
| `GET /shifts/:id` | ✅ all | ✅ all | ✅ own only | ❌ |
| `PATCH /shifts/:id` | ✅ all | ✅ all | ✅ own only (PENDING) | ❌ |
| `DELETE /shifts/:id` | ✅ all | ✅ all | ✅ own only (PENDING) | ❌ |
| `GET /shifts/uninvoiced` | ✅ all | ✅ all | ✅ own only | ❌ |
| `POST /shifts/voice-parse` | ✅ | ✅ | ✅ | ❌ |
| `GET /dashboard/summary` | ✅ all | ✅ all | ✅ own only | ❌ |

- "own only" = a TECHNICIAN may only read or mutate shifts where `shift.userId === req.user.id`; otherwise `403 FORBIDDEN`.
- SUPER_ADMIN uses the existing admin module and must not be granted tenant shift routes.

---

## SECTION 14 — AUDIT LOGGING

| Event | When | Required metadata |
|---|---|---|
| `SHIFT_LOGGED` | shift created | `shiftId, clientId, supportItemCode, totalHours, travelKms, totalAmount, rateTiers[], isPublicHoliday, holidaySource, voiceAssisted (bool), idempotentReplay (bool)` |
| `SHIFT_UPDATED` | shift edited | `shiftId, changedFields[], oldTotalAmount, newTotalAmount` |
| `SHIFT_DELETED` | shift cancelled | `shiftId, clientId, cancelledTotalAmount` |
| `SHIFT_VOICE_PARSED` | voice parse completed | `matched (bool), clientCandidatesCount, confidenceBucket ('LOW'|'MEDIUM'|'HIGH'), missingFieldsCount, ndisNumberRedacted (bool)` — **never** the transcript |

- Never log the audio, the transcript, the participant's full name, or the NDIS number in audit metadata.
- Audit writes must not fail the request silently: follow the same pattern already used in Modules 1–3 (`recordAuditEvent` awaited after the transaction).

---

## SECTION 15 — TESTING REQUIREMENTS

### 15.1 Mandatory test files

| File | Coverage |
|---|---|
| `tests/shift.engine.test.ts` | The full 22-case matrix in Section 7.6 — this is the highest-value test file |
| `tests/shift.validators.test.ts` | Zod schemas: time format, date bounds (future/90-day), travel bounds, notes length, enum values |
| `tests/shift.service.test.ts` | Overlap detection, duplicate detection, idempotency replay, invoiced immutability, cancel idempotency (use mocked Prisma) |
| `tests/voiceParser.test.ts` | Zod validation of the AI JSON, redaction of 9-digit sequences, client matching (exact/prefix/none), missing-field handling — **no real network calls** |

### 15.2 Testing rules

- Unit tests must not call Groq, Gemini, or the database. Mock them.
- Every engine boundary (19:59/20:00/20:01, 23:59/00:00, DST days, holiday midnight) must have an explicit test — these are the cases that produce real money errors.
- Engine tests must assert on **`Decimal` string values** (e.g. `'258.39'`) to avoid float-comparison flakiness.
- The existing suite (`npm test`) must stay green.

---

## SECTION 16 — ENVIRONMENT VARIABLES

Additions to the existing `.env` (the rest already exist for Modules 1–3):

```bash
# Voice AI (free tiers)
GROQ_API_KEY="gsk_..."        # console.groq.com → API Keys
GEMINI_API_KEY="AIza..."      # aistudio.google.com → Get API key

# Optional tuning (defaults shown)
VOICE_MAX_FILE_MB=5
VOICE_MAX_SECONDS=60
VOICE_DAILY_LIMIT_PER_USER=30
```

Rules:
- Both keys are validated at boot through the existing env config (`src/config/env.ts`). If `GROQ_API_KEY` or `GEMINI_API_KEY` is missing, the server MUST still start and `POST /shifts/voice-parse` must return `503 VOICE_UNAVAILABLE` (manual logging must never break because of a missing AI key).
- Never log or return these keys. Never expose them to the frontend — the frontend never calls Groq/Gemini directly.

---

## SECTION 17 — ACCEPTANCE CRITERIA (DEFINITION OF DONE)

A feature is only "done" when every box below is verifiably true.

**Calculation engine**
1. ☐ All 22 engine test cases pass with exact decimal amounts.
2. ☐ Rates are read from `NdisSupportItem`; no rate literal exists anywhere in Module 4 source.
3. ☐ `min(agreed, cap)` is applied to time tiers only; travel always uses the statutory km rate.
4. ☐ Overnight shifts split at local midnight; tiers follow each day.
5. ☐ DST spring-forward and fall-back produce correct real durations.
6. ☐ Public holidays are auto-detected per business state, and the manual override works both ways.

**Persistence**
7. ☐ `ShiftLineItem` rows exist for every shift and contain the snapshotted `appliedRate`/`ndisCapRate`.
8. ☐ `Shift.status` and `isInvoiced` never contradict each other.
9. ☐ `Client.allocatedBudgetSpent` equals the sum of non-cancelled shift totals after every create/edit/cancel.
10. ☐ Cancelling a shift never removes rows (soft cancel only).

**API**
11. ☐ Every endpoint enforces tenant scoping (`businessId`) — verified by a test or manual check.
12. ☐ TECHNICIAN cannot read or mutate another worker's shift (`403`).
13. ☐ Invoiced shifts cannot be edited or deleted (`409 SHIFT_ALREADY_INVOICED`).
14. ☐ Overlap and duplicate checks return `409` with the conflicting shift id.
15. ☐ `Idempotency-Key` replay returns the original shift instead of creating a second one.
16. ☐ Trial caps: 6th shift → `403 TRIAL_SHIFT_LIMIT_REACHED`; 4th voice parse → `403 TRIAL_VOICE_LIMIT_REACHED`; Starter voice → `403 VOICE_PLAN_REQUIRED`.
17. ☐ Validation errors use the existing envelope with field-level `errors` keyed by field name.

**Voice**
18. ☐ Audio is never persisted; no temp files are created.
19. ☐ No surname / NDIS number is sent to any provider (manual code inspection + redaction test).
20. ☐ Voice parse never creates a shift.
21. ☐ Provider timeout degrades to a clear error and the manual path still works.
22. ☐ Missing AI keys do not crash the server (`503 VOICE_UNAVAILABLE` only on that endpoint).

**Dashboard**
23. ☐ `GET /dashboard/summary` returns all documented fields in one request.
24. ☐ `changePercent` is `null` (not `Infinity`/`NaN`) when last week had zero earnings.
25. ☐ `budgetWatch` lists only ≥ 70% clients, max 10, sorted descending.

**Quality**
26. ☐ `npm run typecheck` passes.
27. ☐ `npm test` passes (existing + new tests).
28. ☐ Every state change writes an audit event with the documented metadata and no sensitive data.
29. ☐ No changes to Modules 1–3 behaviour beyond the additive list in Section 6.4.

---

## SECTION 18 — V2 BACKLOG (DO NOT BUILD IN V1)

### 18.1 Sleepover / night work (why it is deferred)

- Night-time sleepover is a **distinct NDIS support item** with a flat nightly price, not an hourly rate.
- The exact item code and price change between price-guide releases, and a wrong code causes plan-manager rejection.
- To build it correctly the business owner must supply, from the official **NDIS Support Catalogue** (ndis.gov.au → Pricing arrangements → Support Catalogue):
  1. the sleepover **support item number**,
  2. its **unit** (`Night`/`Each`),
  3. the **National price limit** (and Remote / Very Remote if used),
  4. whether a separate "night-time" hourly item applies for active night support.
- v1 behaviour in the meantime: overnight shifts are billed with the normal tiers split at midnight (Section 4.4) — this is NDIS-valid for standard overnight support.

### 18.2 Other deferred items
See Section 2.2. Each will get its own specification addendum before implementation.

---

## SECTION 19 — IMPLEMENTATION PHASES (SUGGESTED ORDER)

| Phase | Work | Exit criteria |
|---|---|---|
| 1 | Prisma schema additions + migration | `prisma migrate` clean; types generated |
| 2 | Catalog/rate-table loader + engine (`shift.engine.ts`) | All 22 engine tests pass |
| 3 | Validators + service + controller + routes for CRUD | `POST/GET/PATCH/DELETE` work with tenant scoping and guards |
| 4 | Budget recompute integration + audit events | Acceptance items 9, 10, 28 pass |
| 5 | `GET /shifts/uninvoiced` + `GET /dashboard/summary` | Acceptance items 23–25 pass |
| 6 | Voice pipeline (`voice-parser.ts` + endpoint) | Acceptance items 18–22 pass |
| 7 | Trial/plan gating + rate limits | Acceptance item 16 passes |
| 8 | Full test suite + typecheck + manual smoke test against the live API | Section 17 fully green |

Each phase must be committed separately with a clear message. Do not begin phase N+1 before phase N's exit criteria pass.

---

## SECTION 20 — OPEN QUESTIONS (answer before phase 6; defaults are binding until answered)

| # | Question | Default (binding if unanswered) |
|---|---|---|
| Q1 | Do any customers operate in **Remote / Very Remote** NDIS regions (different price limits)? | Use the **National** rate columns only |
| Q2 | Should voice parsing support languages other than English? | English only (`language: "en"`) |
| Q3 | Is the trial voice allowance exactly 3 (per `TRIAL_LIMITS`)? | Yes — 3 |
| Q4 | Should `TECHNICIAN` be allowed to see the participant's full NDIS number in shift responses? | Yes (they already can in Module 3) |
| Q5 | Should shift notes be required for holiday-rate shifts? | No |

---

## SECTION 21 — RESPONSE CONTRACTS (FRONTEND COMPATIBILITY)

### 21.1 `ShiftView` (the flat object the existing frontend already expects)

```json
{
  "id": "uuid",
  "clientId": "uuid",
  "clientName": "Sarah Jenkins",
  "ndisNumber": "430123456",
  "shiftDate": "2026-08-26",
  "startTime": "18:00",
  "endTime": "21:30",
  "totalHours": 3.5,
  "dayHours": 2.0,
  "eveHours": 1.5,
  "travelKms": 12,
  "hourlyRate": 67.56,
  "dayTotal": 135.12,
  "eveTotal": 111.63,
  "travelTotal": 11.64,
  "grandTotal": 258.39,
  "supportItemCode": "01_011_0107_1_1",
  "caseNotes": "…",
  "status": "PENDING",
  "isInvoiced": false,
  "isPublicHoliday": false,
  "publicHolidayName": null,
  "timezone": "Australia/Sydney",
  "calculatedAt": "2026-08-26T09:12:00.000Z",
  "createdAt": "2026-08-26T09:12:00.000Z",
  "lineItems": [
    {
      "rateTier": "DAY",
      "supportItemCode": "01_011_0107_1_1",
      "description": "Weekday Daytime Support (18:00 - 20:00)",
      "quantity": 2.0,
      "unit": "Hour",
      "ndisCapRate": 67.56,
      "appliedRate": 67.56,
      "amount": 135.12,
      "segmentStart": "2026-08-26T08:00:00.000Z",
      "segmentEnd": "2026-08-26T10:00:00.000Z",
      "sortOrder": 0
    }
  ]
}
```

**Field compatibility rules (mandatory):**
- `dayHours`/`dayTotal` = the sum of all `DAY` tier lines; `eveHours`/`eveTotal` = the sum of all `EVENING` tier lines. Saturday/Sunday/holiday hours are **not** folded into `dayHours`; they are exposed through `lineItems` and the totals. (The frontend shows a per-tier breakdown from `lineItems`.)
- `hourlyRate` = the effective applied rate of the **first time-tier line** (for display compatibility).
- Money and hours are serialised as **numbers** (2-decimal), never Prisma Decimal strings — see the existing `Number(...)` serialisation pattern used in the Module 3 client service.
- `status` must be one of `PENDING` | `INVOICED` | `CANCELLED`.
- Dates: `shiftDate` is `YYYY-MM-DD`; all `*At` fields are ISO-8601 UTC strings.

### 21.2 Budget block (included in shift create/update responses)

```json
{ "allocatedTotal": 15000.0, "allocatedSpent": 258.39, "utilizationPercent": 1.72, "level": "OK" }
```

### 21.3 Contract rules for implementers

- Do not rename any field in `ShiftView`. The frontend ships against these names.
- Do not add undocumented fields. Extra data belongs in `lineItems`.
- All list endpoints return `items` + `pagination` (existing convention).

---

**END OF MODULE 4 BACKEND SPECIFICATION — v1.0**
