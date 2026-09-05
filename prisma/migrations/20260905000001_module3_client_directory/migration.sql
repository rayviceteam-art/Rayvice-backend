-- ============================================================================
-- Module 3 migration: NDIS Participant & Plan Manager Directory
-- Assumes businesses, shifts, invoices tables already exist.
-- ============================================================================

-- 1. Enum for plan management type
DO $$ BEGIN
    CREATE TYPE "PlanManagementType" AS ENUM ('PLAN_MANAGED', 'SELF_MANAGED', 'NDIA_MANAGED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add Module 3 columns to clients table if table exists, or create table
CREATE TABLE IF NOT EXISTS "clients" (
    "id"                         TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    "business_id"                TEXT NOT NULL,
    "participant_name"           TEXT NOT NULL,
    "ndis_number"                TEXT NOT NULL,
    "dateOfBirth"                TIMESTAMP(3),
    "plan_management_type"       "PlanManagementType" NOT NULL DEFAULT 'PLAN_MANAGED',
    "plan_manager_agency_name"   TEXT,
    "plan_manager_email"         TEXT,
    "self_managed_billing_email" TEXT,
    "self_managed_billing_phone" TEXT,
    "hourly_rate_agreed"         DECIMAL(10,2),
    "default_support_item_code"  TEXT,
    "allocated_budget_total"     DECIMAL(10,2),
    "allocated_budget_spent"     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "is_active"                  BOOLEAN NOT NULL DEFAULT true,
    "created_at"                 TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updated_at"                 TIMESTAMP(3) NOT NULL DEFAULT now(),
    "deleted_at"                 TIMESTAMP(3),

    CONSTRAINT "clients_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE
);

-- 3. Indexes required for tenant-scoped lookups and search
CREATE INDEX IF NOT EXISTS "clients_business_id_idx" ON "clients"("business_id");
CREATE INDEX IF NOT EXISTS "clients_ndis_number_idx" ON "clients"("ndis_number");

-- 4. Tenant-scoped uniqueness on NDIS number, active rows only.
CREATE UNIQUE INDEX IF NOT EXISTS "clients_business_id_ndis_number_active_key"
    ON "clients"("business_id", "ndis_number")
    WHERE "deleted_at" IS NULL;
