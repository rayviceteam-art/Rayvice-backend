-- ============================================================================
-- Module 4 migration: Shift Logging & Deterministic NDIS Auto-Split Engine
-- Additive only — no existing column is renamed, retyped or dropped.
-- Safe to run on a database that already contains Modules 1-3 data.
-- ============================================================================

-- 1. New enums ---------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "PlanTier" AS ENUM ('TRIAL', 'STARTER', 'PRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "ShiftStatus" AS ENUM ('PENDING', 'INVOICED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "RateTier" AS ENUM ('DAY', 'EVENING', 'SATURDAY', 'SUNDAY', 'HOLIDAY', 'TRAVEL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
    CREATE TYPE "RateSource" AS ENUM ('AUTO', 'MANUAL', 'NOT_HOLIDAY');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Extend the existing AuditAction enum ------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_LOGGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SHIFT_VOICE_PARSED';

-- 3. businesses: timezone + plan tier ---------------------------------------
ALTER TABLE "businesses"
    ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'Australia/Sydney',
    ADD COLUMN IF NOT EXISTS "plan_tier" "PlanTier" NOT NULL DEFAULT 'TRIAL';

-- 4. shifts: deterministic split engine fields ------------------------------
ALTER TABLE "shifts"
    ADD COLUMN IF NOT EXISTS "status" "ShiftStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS "support_item_code" TEXT,
    ADD COLUMN IF NOT EXISTS "start_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "end_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "timezone_used" TEXT,
    ADD COLUMN IF NOT EXISTS "total_amount" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "hourly_rate_applied" DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "is_public_holiday" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "public_holiday_name" TEXT,
    ADD COLUMN IF NOT EXISTS "holiday_source" "RateSource",
    ADD COLUMN IF NOT EXISTS "calculated_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT,
    ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);

-- 5. shift_line_items: snapshotted rate-split lines -------------------------
CREATE TABLE IF NOT EXISTS "shift_line_items" (
    "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "shift_id"          TEXT NOT NULL,
    "business_id"       TEXT NOT NULL,
    "rate_tier"         "RateTier" NOT NULL,
    "support_item_code" TEXT NOT NULL,
    "description"       TEXT NOT NULL,
    "quantity"          DECIMAL(10,2) NOT NULL,
    "unit"              TEXT NOT NULL DEFAULT 'Hour',
    "ndis_cap_rate"     DECIMAL(10,2) NOT NULL,
    "applied_rate"      DECIMAL(10,2) NOT NULL,
    "amount"            DECIMAL(10,2) NOT NULL,
    "segment_start"     TIMESTAMP(3),
    "segment_end"       TIMESTAMP(3),
    "sort_order"        INTEGER NOT NULL DEFAULT 0,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT now()
);

-- 6. Constraints & indexes ---------------------------------------------------
DO $$ BEGIN
    ALTER TABLE "shift_line_items"
        ADD CONSTRAINT "shift_line_items_shift_id_fkey"
        FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "shifts_business_id_idempotency_key_key"
    ON "shifts"("business_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "shifts_business_id_status_idx" ON "shifts"("business_id", "status");
CREATE INDEX IF NOT EXISTS "shifts_business_id_shift_date_idx" ON "shifts"("business_id", "shift_date");
CREATE INDEX IF NOT EXISTS "shifts_user_id_start_at_idx" ON "shifts"("user_id", "start_at");
CREATE INDEX IF NOT EXISTS "shift_line_items_shift_id_idx" ON "shift_line_items"("shift_id");
CREATE INDEX IF NOT EXISTS "shift_line_items_business_id_idx" ON "shift_line_items"("business_id");
