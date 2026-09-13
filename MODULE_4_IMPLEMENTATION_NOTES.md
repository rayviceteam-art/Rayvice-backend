# Module 4 — Implementation Notes (merged into this repository)

Backend implementation of **Shift Logging & Deterministic NDIS Auto-Split Engine**,
built from `MODULE_4_BACKEND_SPECIFICATION.md` (the binding contract).

Status: **merged, typechecked, tests passing**. Two manual steps remain (DB migration
+ environment variables) — see "Deployment steps" below.

---

## 1. What was added

| Path | Purpose |
|---|---|
| `src/shifts/shift.engine.ts` | Pure, deterministic split engine (Section 7) — no I/O, no AI |
| `src/shifts/shift.types.ts` | Engine contracts (`Prisma.Decimal` based) |
| `src/shifts/holiday.service.ts` | Australian public holidays via offline `date-holidays` |
| `src/shifts/rateTable.loader.ts` | The only place NDIS rates are read (from `NdisSupportItem`) |
| `src/shifts/shift.validators.ts` | Zod schemas + request wrappers used by `validateRequest` |
| `src/shifts/shift.mapper.ts` | `ShiftView` response contract (Section 21) |
| `src/shifts/shift.service.ts` | Orchestration: gates, overlap/duplicate checks, transaction, audit |
| `src/shifts/shift.controller.ts` + `shift.routes.ts` | HTTP layer (`/api/v1/shifts`, `/api/shifts`) |
| `src/shifts/voice-parser.ts` + `voice.controller.ts` | Groq Whisper → Gemini JSON → preview (never saves) |
| `src/dashboard/dashboard.service.ts` + `dashboard.routes.ts` | `GET /api/v1/dashboard/summary` |
| `prisma/migrations/20260914000000_module4_shift_engine/` | Additive SQL migration |
| `tests/shift.engine.test.ts` | 25 engine cases (the 22-case matrix + guards) |
| `tests/shift.validators.test.ts`, `tests/voiceParser.test.ts`, `tests/shift.mapper.test.ts` | Unit tests (node:test) |

### Additive changes to existing files (nothing else was touched)

- `src/utils/ApiError.ts` — added `unprocessable`, `tooLarge`, `unsupportedMediaType`, `serviceUnavailable`, `gatewayTimeout`; `conflict()` now accepts `details`; `internal()` accepts an `errorCode`.
- `src/business/trial.util.ts` — `checkTrialResourceLimit` accepts the `'voice'` resource type (counts `SHIFT_VOICE_PARSED` audit rows, so deleting shifts cannot reset usage).
- `src/clients/client.service.ts` — added `recalculateClientBudgetSpent()` and `budgetLevel()`.
- `src/business/business.service.ts` — added `timezoneForState()`; a saved `state` now updates `Business.timezone`.
- `src/config/env.ts` — added optional `GROQ_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `VOICE_*` (the server boots without them; only voice-parse returns `503 VOICE_UNAVAILABLE`).
- `src/app.ts` — mounts the shift and dashboard routers.
- `prisma/schema.prisma` — additive enums/models/fields (see Section 3 below).

## 2. Test / typecheck status

```
npm run typecheck   -> 0 errors
npm test            -> 83/84 passing
```

The only failure is `tests/client.test.ts`, which imports the Prisma client and cannot
load the query engine on the authoring device (Android/aarch64 vs a downloaded
linux-x64 engine). It is an environment limitation, not a code regression — it passes
on CI/x64 machines.

## 3. Database changes (additive)

- Enums: `PlanTier`, `ShiftStatus`, `RateTier`, `RateSource`; `AuditAction` gains `SHIFT_LOGGED`, `SHIFT_UPDATED`, `SHIFT_DELETED`, `SHIFT_VOICE_PARSED`.
- `businesses`: `timezone` (default `Australia/Sydney`), `plan_tier` (default `TRIAL`).
- `shifts`: `status`, `support_item_code`, `start_at`, `end_at`, `timezone_used`, `total_amount`, `hourly_rate_applied`, `is_public_holiday`, `public_holiday_name`, `holiday_source`, `calculated_at`, `idempotency_key`, `cancelled_at` + indexes + `@@unique([businessId, idempotencyKey])`.
- New table `shift_line_items` with the **snapshotted** `ndis_cap_rate` / `applied_rate` per claim line.

## 4. Deployment steps (the only manual work left)

### 4.1 Apply the database migration (required)

Run **once** against the production database, from a machine with the real
`DATABASE_URL` (x64 Linux/macOS/Windows — Prisma engines do not run on Android):

```bash
npx prisma migrate deploy
```

Use `migrate deploy` (not `migrate dev`) so production data is never reset.
Fallback: paste `prisma/migrations/20260914000000_module4_shift_engine/migration.sql`
into the Neon SQL editor — it is idempotent (`IF NOT EXISTS`) and additive.

Then confirm:

```bash
npx prisma generate
npm run typecheck
```

### 4.2 Environment variables (Render → Environment)

| Key | Value | Notes |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` | Whisper transcription (free tier) |
| `GEMINI_API_KEY` | `AQ....` | Structured JSON extraction (free tier) |
| `GEMINI_MODEL` | *(optional)* `gemini-2.5-flash` | Default is already `gemini-2.5-flash`; Gemini 1.5 Flash is retired |

Both keys are optional at boot: without them the API starts normally and only
`POST /shifts/voice-parse` returns `503 VOICE_UNAVAILABLE`. Manual shift logging,
the split engine and the dashboard work regardless.

## 5. Behaviour highlights (from the specification)

- Rate tiers: weekday day/evening split at **20:00 local**, Saturday, Sunday, public holiday, travel — all read from the seeded `NdisSupportItem` catalogue (never hardcoded).
- Effective rate: `min(Client.hourlyRateAgreed, NDIS cap)` for time tiers; travel always uses the statutory per-km rate.
- Overnight shifts split at local midnight; each segment is rated by its own day.
- All tier decisions use the **business timezone** (luxon) so DST and state holidays are correct.
- Public holidays: auto-detected per state (`date-holidays`) with a manual override flag.
- Invoiced shifts are immutable; deletes are soft cancels (`status = CANCELLED`).
- Trial gates: 5 shifts, 3 voice parses; voice requires the Pro tier (`Business.planTier`).
- Budget: `Client.allocatedBudgetSpent` is recomputed after every shift create/edit/cancel.
