-- ============================================================================
-- Module 5 migration: NDIS Tax Invoicing & Stripe Subscription Billing
-- Additive only — no existing column is renamed, retyped or dropped.
-- Safe to run on a database that already contains Modules 1-4 data.
-- ============================================================================

-- 1. Extend AuditAction enum -------------------------------------------------
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_SENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_RESENT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_PAID';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'INVOICE_PDF_VIEWED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PRODA_EXPORT_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_CHECKOUT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_PAYMENT_FAILED';

-- 2. businesses: Stripe customer & subscription fields -----------------------
ALTER TABLE "businesses"
    ADD COLUMN IF NOT EXISTS "stripe_customer_id" TEXT,
    ADD COLUMN IF NOT EXISTS "stripe_subscription_id" TEXT,
    ADD COLUMN IF NOT EXISTS "subscription_status" TEXT,
    ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "plan_started_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "businesses_stripe_customer_id_key"
    ON "businesses"("stripe_customer_id");

-- 3. invoices: Module 5 fields & indexes ------------------------------------
ALTER TABLE "invoices"
    ADD COLUMN IF NOT EXISTS "invoice_year" INTEGER,
    ADD COLUMN IF NOT EXISTS "sequence_number" INTEGER,
    ADD COLUMN IF NOT EXISTS "plan_manager_agency_name" TEXT,
    ADD COLUMN IF NOT EXISTS "plan_management_type" "PlanManagementType",
    ADD COLUMN IF NOT EXISTS "participant_ndis_number" TEXT,
    ADD COLUMN IF NOT EXISTS "business_abn" TEXT,
    ADD COLUMN IF NOT EXISTS "business_bsb" TEXT,
    ADD COLUMN IF NOT EXISTS "business_account_number" TEXT,
    ADD COLUMN IF NOT EXISTS "business_account_name" TEXT,
    ADD COLUMN IF NOT EXISTS "business_bank_name" TEXT,
    ADD COLUMN IF NOT EXISTS "business_name" TEXT,
    ADD COLUMN IF NOT EXISTS "business_email" TEXT,
    ADD COLUMN IF NOT EXISTS "business_phone" TEXT,
    ADD COLUMN IF NOT EXISTS "business_address" TEXT,
    ADD COLUMN IF NOT EXISTS "shield_report" JSONB,
    ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "email_message_id" TEXT,
    ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "notes" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_business_id_invoice_year_sequence_number_key"
    ON "invoices"("business_id", "invoice_year", "sequence_number");
CREATE INDEX IF NOT EXISTS "invoices_business_id_issue_date_idx"
    ON "invoices"("business_id", "issue_date");

-- 4. invoice_line_items: unit field -----------------------------------------
ALTER TABLE "invoice_line_items"
    ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'Hour';

-- 5. invoice_sequences table ------------------------------------------------
CREATE TABLE IF NOT EXISTS "invoice_sequences" (
    "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "business_id" TEXT NOT NULL,
    "year"        INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT now()
);

DO $$ BEGIN
    ALTER TABLE "invoice_sequences"
        ADD CONSTRAINT "invoice_sequences_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_sequences_business_id_year_key"
    ON "invoice_sequences"("business_id", "year");

-- 6. stripe_events table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "stripe_events" (
    "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "event_id"     TEXT NOT NULL,
    "type"         TEXT NOT NULL,
    "business_id"  TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "payload"      JSONB
);

DO $$ BEGIN
    ALTER TABLE "stripe_events"
        ADD CONSTRAINT "stripe_events_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_events_event_id_key"
    ON "stripe_events"("event_id");
