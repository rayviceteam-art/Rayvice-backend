# 🚀 RAYVICE — NDIS SOLE-TRADER BILLING & COMPLIANCE OS (AUSTRALIA)
## COMPREHENSIVE BACKEND ENGINEERING SPECIFICATION & ARCHITECTURE MASTERPLAN

> **Document Version**: 2.0.0 (Production Blueprint)  
> **Target Audience**: Backend Developers, Full-Stack Engineers, AI Coding Agents  
> **Core Objective**: Eliminate 100% of ambiguities so any AI agent or software engineer can build the exact system without guessing business logic, data models, or compliance rules.  
> **Target Market**: Australia — National Disability Insurance Scheme (NDIS) Sole Traders (Support Workers, Cleaners, Independent Carers, Allied Health Assistants).

---

## 1. SYSTEM ARCHITECTURE & INTEGRATION ECOSYSTEM

Rayvice is an automated billing, rate-splitting, and compliance SaaS engine built specifically for Australian NDIS Sole Traders.

```mermaid
graph TD
    subgraph "Client Layer"
        NextApp[Next.js 14+ App Router Frontend]
    end

    subgraph "API Gateway & Security Layer"
        ExpressApp[Express.js TypeScript Engine]
        AuthGuard[authenticate & authorize Middleware]
        TenantGuard[Tenant Isolation Context - businessId]
        RateLimiter[generalRateLimiter]
    end

    subgraph "Core Business Service Modules"
        Module1[Module 1: Auth & Multi-Tenant Foundation]
        Module2[Module 2: Business Profile & Bank Details]
        Module3[Module 3: NDIS Participant & Plan Manager Directory]
        Module4[Module 4: Shift Ingestion & Auto-Split Engine]
        Module5[Module 5: Invoicing, Auto-Rejection Shield & Dispatch]
    end

    subgraph "External Integrations & Cloud Infrastructure"
        NeonDB[(Neon PostgreSQL Serverless DB)]
        ResendAPI[Resend Transactional Email API]
        GroqGemini[Groq Whisper + Gemini Flash Voice AI]
        StripeBilling[Stripe Australian Subscriptions]
    end

    NextApp -->|Bearer JWT + HttpOnly Cookie| ExpressApp
    ExpressApp --> RateLimiter
    RateLimiter --> AuthGuard
    AuthGuard --> TenantGuard
    TenantGuard --> Module1 & Module2 & Module3 & Module4 & Module5

    Module1 & Module2 & Module3 & Module4 & Module5 -->|Prisma Client| NeonDB
    Module4 -->|Speech-to-Text & JSON Extraction| GroqGemini
    Module5 -->|PDF Generation & Direct Dispatch| ResendAPI
    Module5 -->|Subscription Gating| StripeBilling
```

---

## 2. MODULAR MASTER MATRIX & IMPLEMENTATION STATUS

| Module | Status | Name | Core Business Objective | Primary Endpoints |
| :--- | :--- | :--- | :--- | :--- |
| **Module 1** | ✅ **DONE** | **Auth & Tenant Foundation** | Multi-tenant user registration, secure session tokens, brute-force lockout, Google OAuth, 9-day trial. | `/api/v1/auth/*` |
| **Module 2** | ✅ **DONE** | **Business Profile & Bank Details** | Australian ABN (ATO Modulo-89), BSB (`XXX-XXX`), Bank Account, custom invoice prefixes, GST & Pre-Flight compliance check. | `/api/v1/business/profile`, `/api/v1/business/bank-details`, `/api/v1/business/compliance-status` |
| **Module 3** | ✅ **DONE** | **NDIS Participant Directory** | 9-digit NDIS validation, Plan Management routing (Plan-Managed vs Self-Managed), budget caps, NDIS catalogue seeding. | `/api/v1/clients/*` |
| **Module 4** | 📋 **SPEC READY** | **Shift Logging & Auto-Split Engine** | Voice/Text shift intake, 8:00 PM evening rate threshold split, overnight midnight split, DST-aware timezone rating, weekend/holiday rates, travel km math, budget tracking, dashboard summary. See `MODULE_4_BACKEND_SPECIFICATION.md`. | `/api/v1/shifts/*`, `/api/v1/shifts/voice-parse`, `/api/v1/dashboard/summary` |
| **Module 5** | 🔨 **TODO** | **Invoicing, Shield & Dispatch** | Pre-Flight Auto-Rejection Shield, compliant PDF generation, direct Plan Manager email delivery, Stripe gating. | `/api/v1/invoices/*`, `/api/v1/invoices/generate` |

---

## 2.1 PRICING TIERS, 9-DAY FREE TRIAL & FEATURE GATING RULES

### A. Subscription Plans & Tier Limits (AUD)

| Feature / Metric | 🎁 9-Day Free Trial | ⚡ Starter Plan ($24 AUD/mo) | 🚀 Pro Plan ($44 AUD/mo) |
| :--- | :--- | :--- | :--- |
| **Price** | **$0 AUD** (No credit card) | **$24 AUD / month** | **$44 AUD / month** |
| **Duration / Billing** | 9 Days (216 hours) | Monthly Recurring (Stripe) | Monthly Recurring (Stripe) |
| **Active Participants** | **Max 1 Participant** | **Max 5 Participants** | **Unlimited Participants** |
| **Shift Logging** | Up to 5 Shifts | **Unlimited Shifts** | **Unlimited Shifts** |
| **Live Rate-Split Engine**| ✅ Full (Day/Evening/Weekend) | ✅ Full | ✅ Full |
| **Compliant Invoicing** | Up to 2 Invoices | Up to 20 Invoices / month | **Unlimited Invoices** |
| **Pre-Flight Shield** | ✅ Active (Zero Rejections) | ✅ Active | ✅ Active |
| **Direct Email Dispatch** | ✅ 2 Test Dispatches | ✅ Resend API Delivery | ✅ Resend API Delivery |
| **Voice AI Logging** | 3 Voice Transcriptions | Manual Shift Logging | 🎙️ **Unlimited Voice AI** |
| **ATO / PRODA Export** | ❌ None | Standard PDF Invoices | ✅ PRODA CSV + PDF Invoices |

### B. Free Trial Gating & Enforcement Logic
1. **Creation:** Upon registration (`POST /api/v1/auth/register`), the business record is created with `status = 'TRIALING'`, `hasUsedTrial = true`, and `trialEndsAt = now() + 216 hours` (9 days).
2. **Participant Creation Guard:** If `business.status === 'TRIALING'`, `POST /api/v1/clients` checks if active client count >= 1. If so, rejects with `403 Forbidden: Free trial is limited to 1 active participant. Upgrade to Starter or Pro to add more.`
3. **Shift Creation Guard:** If `business.status === 'TRIALING'`, `POST /api/v1/shifts` checks if total logged shifts >= 5. If so, returns `403 Forbidden: Free trial limit of 5 shifts reached. Subscribe to continue logging.`
4. **Invoice Generation Guard:** If `business.status === 'TRIALING'`, `POST /api/v1/invoices/generate` checks if total generated invoices >= 2.
5. **Trial Expiration (`READ_ONLY` Mode):**
   - Evaluated dynamically in `trial.util.ts`: if `status === 'TRIALING'` and `trialEndsAt <= now()`, effective status is `READ_ONLY`.
   - In `READ_ONLY` mode, all `POST`, `PUT`, and `DELETE` operational requests return `402 Payment Required: Your 9-day trial has ended. Please choose a subscription plan to resume operations.`
   - All `GET` requests (historical tax invoices, participant records, audit logs) remain 100% accessible to satisfy ATO 5-year tax record retention laws.

---

## 3. COMPLETE DATABASE SCHEMA (PRISMA ORM)

All models are strictly multi-tenant isolated via `businessId`.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// -----------------------------------------------------------------------------
// Enums
// -----------------------------------------------------------------------------
enum UserRole {
  OWNER
  OFFICE_MANAGER
  TECHNICIAN
}

enum UserStatus {
  INVITED
  ACTIVE
  SUSPENDED
}

enum BusinessStatus {
  TRIALING
  ACTIVE
  READ_ONLY
  SUSPENDED
}

enum PlanTier {
  TRIAL   // 9-day free trial (default)
  STARTER // $24 AUD / month — manual shift logging only
  PRO     // $44 AUD / month — unlocks unlimited Voice AI
}

enum ShiftStatus {
  PENDING   // logged, not yet invoiced (default)
  INVOICED  // attached to an invoice — immutable
  CANCELLED // voided by the worker (soft cancel, row is kept for audit)
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
  AUTO        // holiday detected automatically from the state holiday calendar
  MANUAL      // worker explicitly marked the day as a public holiday
  NOT_HOLIDAY // worker explicitly marked the day as NOT a holiday
}

enum AuditAction {
  BUSINESS_REGISTERED
  USER_INVITED
  USER_INVITE_ACCEPTED
  LOGIN_SUCCESS
  LOGIN_FAILED
  LOGOUT
  TOKEN_REFRESHED
  PASSWORD_RESET_REQUESTED
  PASSWORD_RESET_COMPLETED
  PASSWORD_CHANGED
  EMAIL_VERIFICATION_SENT
  EMAIL_VERIFIED
  USER_SUSPENDED
  USER_REACTIVATED
  CLIENT_CREATED
  CLIENT_UPDATED
  CLIENT_DELETED
  SHIFT_LOGGED
  SHIFT_UPDATED
  SHIFT_DELETED
  SHIFT_VOICE_PARSED
  INVOICE_GENERATED
  INVOICE_SENT
  INVOICE_PAID
  INVOICE_CANCELLED
}

enum PlanManagementType {
  PLAN_MANAGED
  SELF_MANAGED
  NDIA_MANAGED
}

enum InvoiceStatus {
  DRAFT
  SENT
  PAID
  REJECTED
  CANCELLED
}

// -----------------------------------------------------------------------------
// Module 1 & 2: Business & User Management
// -----------------------------------------------------------------------------
model Business {
  id            String         @id @default(uuid())
  name          String
  email         String         @unique
  phone         String?
  industry      String?

  // Australian Tax & Banking Compliance Fields (Module 2)
  abn           String?        // 11 digits without spaces, e.g. "51824753556"
  bsb           String?        // 6 digits format "XXX-XXX", e.g. "062-000"
  accountNumber String?        // 6 to 9 digits, e.g. "12345678"
  bankName      String?        // e.g. "Commonwealth Bank of Australia"
  invoicePrefix String         @default("INV") // e.g. "INV", "RSW"
  isGstRegistered Boolean      @default(false)

  status        BusinessStatus @default(TRIALING)
  planTier      PlanTier       @default(TRIAL) // Module 4/5 — gates Voice AI
  timezone      String         @default("Australia/Sydney") // Module 4 — rate tier correctness
  state         String?        // e.g. "NSW" — drives public holiday calendar
  trialStartedAt DateTime      @default(now())
  trialEndsAt   DateTime
  hasUsedTrial  Boolean        @default(true)

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  deletedAt     DateTime?

  users         User[]
  auditLogs     AuditLog[]
  clients       Client[]
  shifts        Shift[]
  invoices      Invoice[]

  @@index([status])
  @@index([createdAt])
  @@map("businesses")
}

model User {
  id                  String     @id @default(uuid())
  businessId          String
  email               String     @unique
  passwordHash        String
  firstName           String
  lastName            String
  role                UserRole
  status              UserStatus @default(ACTIVE)
  emailVerifiedAt     DateTime?
  lastLoginAt         DateTime?
  failedLoginAttempts Int        @default(0)
  lockedUntil         DateTime?

  createdAt           DateTime   @default(now())
  updatedAt           DateTime   @updatedAt
  deletedAt           DateTime?

  business            Business   @relation(fields: [businessId], references: [id], onDelete: Cascade)
  refreshTokens       RefreshToken[]
  emailVerificationTokens EmailVerificationToken[]
  passwordResetTokens PasswordResetToken[]
  invitationTokens    InvitationToken[]
  auditLogs           AuditLog[]
  shifts              Shift[]

  @@index([businessId])
  @@index([status])
  @@map("users")
}

model RefreshToken {
  id                  String    @id @default(uuid())
  userId              String
  tokenHash           String    @unique
  userAgent           String?
  ipAddress           String?
  expiresAt           DateTime
  revokedAt           DateTime?
  replacedByTokenHash String?
  createdAt           DateTime  @default(now())

  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("refresh_tokens")
}

model EmailVerificationToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_verification_tokens")
}

model PasswordResetToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}

model InvitationToken {
  id         String    @id @default(uuid())
  userId     String
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("invitation_tokens")
}

model AuditLog {
  id         String      @id @default(uuid())
  businessId String?
  userId     String?
  action     AuditAction
  ipAddress  String?
  userAgent  String?
  metadata   Json?
  createdAt  DateTime    @default(now())

  business   Business?   @relation(fields: [businessId], references: [id], onDelete: SetNull)
  user       User?       @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([businessId])
  @@index([userId])
  @@index([action])
  @@index([createdAt])
  @@map("audit_logs")
}

// -----------------------------------------------------------------------------
// Module 3: NDIS Price Catalogue & Participant Directory
// -----------------------------------------------------------------------------
model NdisSupportItem {
  itemNumber             String    @id @map("item_number") // e.g. "01_011_0107_1_1"
  supportItemName        String    @map("support_item_name")
  categoryName           String    @map("category_name")
  unit                   String    @default("Hour") // "Hour", "Each", "KM"
  nationalWeekdayRate    Decimal   @map("national_weekday_rate") @db.Decimal(10, 2) // e.g. 67.56
  nationalEveningRate    Decimal?  @map("national_evening_rate") @db.Decimal(10, 2) // e.g. 74.42 (after 8:00 PM)
  nationalSaturdayRate   Decimal?  @map("national_saturday_rate") @db.Decimal(10, 2) // e.g. 95.07
  nationalSundayRate     Decimal?  @map("national_sunday_rate") @db.Decimal(10, 2) // e.g. 122.59
  nationalHolidayRate    Decimal?  @map("national_holiday_rate") @db.Decimal(10, 2) // e.g. 150.12
  isTravelAllowed        Boolean   @default(true) @map("is_travel_allowed")
  effectiveFrom          DateTime  @map("effective_from")
  effectiveTo            DateTime? @map("effective_to")

  clients                Client[]

  @@map("ndis_support_items")
}

model Client {
  id                     String             @id @default(uuid())
  businessId             String             @map("business_id")
  participantName        String             @map("participant_name")
  ndisNumber             String             @map("ndis_number") // Exactly 9 digits
  dateOfBirth            DateTime?          @map("date_of_birth")
  planManagementType     PlanManagementType @default(PLAN_MANAGED) @map("plan_management_type")
  planManagerAgencyName  String?            @map("plan_manager_agency_name") // e.g. "My Plan Manager"
  planManagerEmail       String?            @map("plan_manager_email") // Invoices sent here
  hourlyRateAgreed       Decimal?           @map("hourly_rate_agreed") @db.Decimal(10, 2)
  defaultSupportItemCode String?            @map("default_support_item_code")
  allocatedBudgetTotal   Decimal?           @map("allocated_budget_total") @db.Decimal(10, 2)
  allocatedBudgetSpent   Decimal            @default(0.00) @map("allocated_budget_spent") @db.Decimal(10, 2)
  isActive               Boolean            @default(true) @map("is_active")

  createdAt              DateTime           @default(now()) @map("created_at")
  updatedAt              DateTime           @updatedAt @map("updated_at")
  deletedAt              DateTime?          @map("deleted_at")

  business               Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)
  defaultSupportItem     NdisSupportItem?   @relation(fields: [defaultSupportItemCode], references: [itemNumber])
  shifts                 Shift[]
  invoices               Invoice[]

  @@index([businessId])
  @@index([ndisNumber])
  @@map("clients")
}

// -----------------------------------------------------------------------------
// Module 4: Shift Logging & Auto-Splitting
// -----------------------------------------------------------------------------
model Shift {
  id                 String      @id @default(uuid())
  businessId         String      @map("business_id")
  userId             String      @map("user_id")
  clientId           String      @map("client_id")
  shiftDate          DateTime    @map("shift_date") @db.Date
  startTime          String      @map("start_time") // "18:00" local business time
  endTime            String      @map("end_time") // "21:30" local; may be earlier than start (overnight)
  totalHours         Decimal     @map("total_hours") @db.Decimal(5, 2)
  travelKms          Decimal     @default(0.0) @map("travel_kms") @db.Decimal(6, 2)
  travelMinutes      Int         @default(0) @map("travel_minutes")
  caseNotes          String?     @map("case_notes") @db.Text
  status             ShiftStatus @default(PENDING) // Module 4 — primary state
  isInvoiced         Boolean     @default(false) @map("is_invoiced") // kept in sync with status = INVOICED
  invoiceId          String?     @map("invoice_id")

  // Module 4 — calculation audit trail
  startAt            DateTime?   @map("start_at") // absolute UTC instant
  endAt              DateTime?   @map("end_at") // absolute UTC instant (may be next day)
  timezoneUsed       String?     @map("timezone_used") // e.g. "Australia/Sydney"
  totalAmount        Decimal?    @map("total_amount") @db.Decimal(10, 2) // sum of rounded line amounts
  hourlyRateApplied  Decimal?    @map("hourly_rate_applied") @db.Decimal(10, 2) // effective time rate
  isPublicHoliday    Boolean     @default(false) @map("is_public_holiday")
  publicHolidayName  String?     @map("public_holiday_name") // e.g. "Christmas Day"
  holidaySource      RateSource? @map("holiday_source")
  calculatedAt       DateTime?   @map("calculated_at")
  idempotencyKey     String?     @map("idempotency_key") // double-submit guard, unique per business
  cancelledAt        DateTime?   @map("cancelled_at")

  createdAt          DateTime    @default(now()) @map("created_at")
  updatedAt          DateTime    @updatedAt @map("updated_at")

  business           Business    @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user               User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  client             Client      @relation(fields: [clientId], references: [id], onDelete: Cascade)
  invoice            Invoice?    @relation(fields: [invoiceId], references: [id], onDelete: SetNull)
  lineItems          ShiftLineItem[]

  @@unique([businessId, idempotencyKey])
  @@index([businessId, isInvoiced])
  @@index([businessId, status])
  @@index([businessId, shiftDate])
  @@index([userId, startAt])
  @@index([clientId])
  @@map("shifts")
}

// -----------------------------------------------------------------------------
// Module 4: Deterministic NDIS rate-split line items
// One row per claimable component of a shift (day / evening / weekend / holiday / travel).
// `appliedRate` and `ndisCapRate` are SNAPSHOTS: historical shifts must never be
// recalculated when the annual NDIS price guide changes.
// -----------------------------------------------------------------------------
model ShiftLineItem {
  id              String    @id @default(uuid())
  shiftId         String    @map("shift_id")
  businessId      String    @map("business_id") // tenant scope
  rateTier        RateTier  @map("rate_tier")
  supportItemCode String    @map("support_item_code") // e.g. "01_011_0107_1_1"
  description     String
  quantity        Decimal   @db.Decimal(10, 2) // hours or kilometres
  unit            String    @default("Hour") // "Hour" | "KM"
  ndisCapRate     Decimal   @map("ndis_cap_rate") @db.Decimal(10, 2)
  appliedRate     Decimal   @map("applied_rate") @db.Decimal(10, 2) // snapshot — never recomputed
  amount          Decimal   @db.Decimal(10, 2)
  segmentStart    DateTime? @map("segment_start")
  segmentEnd      DateTime? @map("segment_end")
  sortOrder       Int       @default(0) @map("sort_order")

  createdAt       DateTime  @default(now()) @map("created_at")

  shift           Shift     @relation(fields: [shiftId], references: [id], onDelete: Cascade)

  @@index([shiftId])
  @@index([businessId])
  @@map("shift_line_items")
}

// -----------------------------------------------------------------------------
// Module 5: Australian Compliant Invoices & Line Items
// -----------------------------------------------------------------------------
model Invoice {
  id              String             @id @default(uuid())
  businessId      String             @map("business_id")
  clientId        String             @map("client_id")
  invoiceNumber   String             @map("invoice_number") // e.g. "INV-2026-001"
  issueDate       DateTime           @default(now()) @map("issue_date") @db.Date
  dueDate         DateTime           @map("due_date") @db.Date
  subtotalAmount  Decimal            @map("subtotal_amount") @db.Decimal(10, 2)
  gstAmount       Decimal            @default(0.00) @map("gst_amount") @db.Decimal(10, 2)
  totalAmount     Decimal            @map("total_amount") @db.Decimal(10, 2)
  status          InvoiceStatus      @default(DRAFT)
  recipientEmail  String             @map("recipient_email")
  pdfUrl          String?            @map("pdf_url")
  sentAt          DateTime?          @map("sent_at")
  paidAt          DateTime?          @map("paid_at")

  createdAt       DateTime           @default(now()) @map("created_at")
  updatedAt       DateTime           @updatedAt @map("updated_at")

  business        Business           @relation(fields: [businessId], references: [id], onDelete: Cascade)
  client          Client             @relation(fields: [clientId], references: [id], onDelete: Restrict)
  shifts          Shift[]
  lineItems       InvoiceLineItem[]

  @@index([businessId, status])
  @@map("invoices")
}

model InvoiceLineItem {
  id              String   @id @default(uuid())
  invoiceId       String   @map("invoice_id")
  serviceDate     DateTime @map("service_date") @db.Date
  supportItemCode String   @map("support_item_code") // e.g. "01_011_0107_1_1"
  description     String
  quantity        Decimal  @map("quantity") @db.Decimal(6, 2)
  unitPrice       Decimal  @map("unit_price") @db.Decimal(10, 2)
  totalAmount     Decimal  @map("total_amount") @db.Decimal(10, 2)

  createdAt       DateTime @default(now()) @map("created_at")

  invoice         Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_line_items")
}
```

---

## 4. DETAILED SPECIFICATION: MODULE BY MODULE

---

### 📌 MODULE 1: AUTHENTICATION & MULTI-TENANT FOUNDATION (IMPLEMENTED)

#### 1.1 Problem & Business Purpose
Australian sole traders require secure, isolated tenant spaces. Registration must automatically provision an enterprise-grade multi-tenant `Business` record and initialize a **9-day free trial** (216 hours, 1 participant limit, 5 shifts, 2 invoices) without requiring credit cards upfront.

#### 1.2 Key Mechanics & Architectural Rules
1. **Tenant Isolation:** Every operational table references `businessId`. All service queries MUST filter by `where: { businessId }`. Cross-tenant data leakage is impossible.
2. **Session Architecture:** 15-minute short-lived JWT access token returned in JSON payload + 7-day secure HttpOnly cookie containing SHA-256 hashed refresh token with automatic rotation and token-family revocation.
3. **Security Protections:** Argon2id/Bcrypt password hashing, 5 consecutive failed attempts trigger a 15-minute account lockout, single-use password reset tokens (1-hour TTL).
4. **Google OAuth 2.0:** Auto-provisions new business if user does not exist, or securely signs into existing business.

---

### 📌 MODULE 2: BUSINESS PROFILE, ABN & BANKING CONFIGURATION (IMPLEMENTED)

#### 2.1 Problem & Business Purpose
Under the **Australian Taxation Office (ATO)** and **NDIA Invoicing Rules**, a tax invoice issued by a sole trader is invalid and immediately rejected by Plan Managers unless it contains:
- Valid 11-digit Australian Business Number (ABN) verified by ATO Modulo 89 algorithm.
- Valid 6-digit Bank State Branch (BSB) code and Account Number for direct EFT payment remittance.
- GST registration indicator (NDIS core supports are generally GST-free, but invoice must state `$0.00 GST`).
- Physical business address for valid tax invoice header.
- Sequential invoice numbering with custom prefix (e.g. `INV`, `SW-`, `CARE-`).

#### 2.2 API Endpoints Specification

##### `GET /api/v1/business/profile` (and `/api/v1/business/me`)
- **Auth:** Required (Any authenticated user of the business).
- **Response `200 OK`:**
```json
{
  "success": true,
  "message": "Business profile retrieved successfully.",
  "data": {
    "id": "b649d2fe-1b77-49d7-83a3-b40b991ff02a",
    "name": "Liam Support Services",
    "email": "liam@support.com.au",
    "phone": "0412 345 678",
    "industry": "NDIS Support Worker",
    "abn": "51824753556",
    "formattedAbn": "51 824 753 556",
    "bsb": "062-000",
    "formattedBsb": "062-000",
    "accountNumber": "12345678",
    "accountName": "Liam Support Services",
    "bankName": "Commonwealth Bank of Australia (CBA)",
    "invoicePrefix": "INV",
    "isGstRegistered": false,
    "address": "123 George Street",
    "suburb": "Sydney",
    "state": "NSW",
    "postcode": "2000",
    "status": "TRIALING",
    "effectiveStatus": "TRIALING",
    "trial": {
      "daysRemaining": 9,
      "isExpired": false,
      "limits": { "MAX_CLIENTS": 1, "MAX_SHIFTS": 5, "MAX_INVOICES": 2 }
    },
    "compliance": {
      "isCompliant": true,
      "readinessPercentage": 100,
      "checklist": { "abn": true, "bankDetails": true, "businessAddress": true, "contactInfo": true, "invoicePrefix": true },
      "missingFields": [],
      "recommendations": []
    }
  }
}
```

##### `PUT /api/v1/business/profile` (and `PATCH /api/v1/business/profile`)
- **Auth:** Required (`OWNER` role only).
- **Zod Validator:** `updateBusinessProfileSchema` (validates ATO Modulo 89 ABN checksum, BSB format, postcode, state).
- **Audit Action:** `BUSINESS_PROFILE_UPDATED`.

##### `GET /api/v1/business/bank-details` & `PUT /api/v1/business/bank-details`
- **Auth:** Required (`OWNER` for PUT).
- **Features:** Auto-identifies Australian financial institution from BSB prefix (CBA, ANZ, Westpac, NAB, Macquarie, etc.).
- **Audit Action:** `BANK_DETAILS_UPDATED`.

##### `POST /api/v1/business/validate-abn`
- **Auth:** Rate-limited helper endpoint for live ABN validation.
- **Body:** `{ "abn": "51824753556" }`
- **Returns:** `{ "isValid": true, "formatted": "51 824 753 556", "digits": "51824753556" }`

##### `GET /api/v1/business/compliance-status`
- **Auth:** Required.
- **Returns:** Pre-Flight NDIS Tax Invoice Compliance Readiness Report with checklist and recommendations.

---

### 📌 MODULE 3: NDIS PARTICIPANT & PLAN MANAGER DIRECTORY

#### 3.1 Problem & Business Purpose
Sole traders support multiple participants across different funding types:
1. **Plan-Managed (85%+):** Invoices are paid by an intermediary agency (e.g. *My Plan Manager*, *Plan Partners*, *MyIntegra*). The invoice MUST be addressed to the participant and emailed directly to the agency's dedicated claims inbox.
2. **Self-Managed (12%):** Invoices are sent directly to the participant or their nominee parent.
3. **NDIA-Managed (3%):** Requires manual PRODA portal claiming (Rayvice generates compliant PRODA export).

Plan managers instantly reject claims if the participant's **9-digit NDIS number** has a typo or the agency claim email is missing.

#### 3.2 API Endpoints Specification

##### `POST /api/v1/clients`
- **Auth:** Required (`OWNER` or `OFFICE_MANAGER`).
- **Request Body:**
```json
{
  "participantName": "Sarah Jenkins",
  "ndisNumber": "430123456",
  "dateOfBirth": "1998-05-14",
  "planManagementType": "PLAN_MANAGED",
  "planManagerAgencyName": "My Plan Manager",
  "planManagerEmail": "invoices@myplanmanager.com.au",
  "hourlyRateAgreed": 67.56,
  "defaultSupportItemCode": "01_011_0107_1_1",
  "allocatedBudgetTotal": 15000.00
}
```
- **Validation Rules:**
  - `ndisNumber`: Must match `/^\d{9}$/`. Check uniqueness within the business.
  - If `planManagementType === 'PLAN_MANAGED'`, `planManagerEmail` and `planManagerAgencyName` are strictly required.

##### `GET /api/v1/clients`
- **Query Params:** `?page=1&pageSize=20&search=Sarah&isActive=true`
- **Response:** List of clients including calculated fields: `pendingUninvoicedShiftsCount` and `allocatedBudgetSpent`.

##### `GET /api/v1/clients/:id`
- **Response:** Detailed client record with budget utilization percentage and last 5 logged shifts.

##### `PUT /api/v1/clients/:id`
- **Updates:** Participant details, plan manager email updates, budget adjustments.

##### `DELETE /api/v1/clients/:id`
- **Soft-Delete:** Sets `deletedAt = new Date()` and `isActive = false`. Preserves historical shifts and tax invoices.

---

### 📌 MODULE 4: SHIFT LOGGING & DETERMINISTIC NDIS AUTO-SPLIT ENGINE

> **FULL IMPLEMENTATION CONTRACT:** `MODULE_4_BACKEND_SPECIFICATION.md` (repository root) is the binding, line-by-line implementation document for this module — engine algorithm, every API contract, error codes, test matrix, permissions matrix and acceptance criteria. This section is the authoritative summary; where the two differ, the dedicated document wins. **No feature may be added that is not described in either document.**

#### 4.1 Problem & Business Purpose
The NDIS Price Guide pays **different rates depending on when support was delivered**, so a single shift is routinely split across several claim lines. Doing that in Excel takes ~5 hours per week and produces invoices that plan managers reject, delaying payment 3–6 weeks.

**Module 4 removes that work:** it converts a logged shift (typed or spoken) into exact, NDIS-capped, reproducible claim line items in milliseconds, and it is the data source for Module 5 invoicing and for the dashboard.

**Determinism guarantee:** the calculation path contains **no AI**. AI is used only to transcribe/structure voice input, and that result must be human-confirmed before saving.

#### 4.2 NDIS Rate Tiers (2026 Price Guide)

| Tier | When it applies (business local time) | Support Item Code | Rate source (`NdisSupportItem`) |
| :--- | :--- | :--- | :--- |
| `DAY` | Weekday (Mon–Fri) 00:00 → 20:00 | `01_011_0107_1_1` | `nationalWeekdayRate` |
| `EVENING` | Weekday (Mon–Fri) 20:00 → midnight | `01_015_0107_1_1` | `nationalEveningRate` |
| `SATURDAY` | Any time Saturday | `01_014_0107_1_1` | `nationalSaturdayRate` |
| `SUNDAY` | Any time Sunday | `01_013_0107_1_1` | `nationalSundayRate` |
| `HOLIDAY` | Any time on a public holiday | `01_012_0107_1_1` | `nationalHolidayRate` |
| `TRAVEL` | Activity-based transport (per km) | `01_799_0107_1_1` | `nationalWeekdayRate` (unit `KM`) |

**Rules:**
1. Rates are **never hardcoded** — all six rows exist in the seeded `NdisSupportItem` catalogue. A missing row fails with `500 SUPPORT_CATALOGUE_INCOMPLETE`.
2. **Tier priority:** `HOLIDAY` > `SUNDAY` > `SATURDAY` > weekday (`DAY`/`EVENING`); `TRAVEL` is always added on top.
3. **`EVENING_THRESHOLD = 20:00` local.** Ends ≤ 20:00 → all `DAY`; starts ≥ 20:00 → all `EVENING`; straddling → split at 20:00.
4. **Early-morning rule:** weekday 00:00–06:00 bills at the `DAY` rate (no separate night tier in v1).
5. **Overnight rule:** shifts crossing midnight split at local `00:00`; each segment is rated using its own day's tier (Friday 22:00 → Saturday 01:00 = 2.00 h `EVENING` + 1.00 h `SATURDAY`).

#### 4.3 Effective Rate Rule (APPROVED)
```
ndisCap       = rate from NdisSupportItem for (item code, tier)
agreedRate    = Client.hourlyRateAgreed (nullable)
effectiveRate = agreedRate === null ? ndisCap : min(agreedRate, ndisCap)
```
- Time tiers only. `TRAVEL` always uses the statutory per-km rate.
- The cap is a legal maximum; a lower agreed rate is billed as agreed.
- Both `ndisCapRate` and `appliedRate` are returned per line for UI transparency.
- `Client.defaultSupportItemCode` pre-fills the shift's support item (fallback `01_011_0107_1_1`).

#### 4.4 Rounding Rules (money must be reproducible)
1. Quantities (hours/km) rounded to **2 decimals**, half-up.
2. `lineAmount = round2(quantity × appliedRate)`.
3. `grandTotal = sum of already-rounded line amounts` (never re-rounded).
4. Storage uses `Prisma.Decimal` / `@db.Decimal(10,2)`. No JS floats, no `toFixed()` for stored money.

#### 4.5 Worked Examples (test fixtures — exact values)

| Example | Input | Result |
| :--- | :--- | :--- |
| A | Wed 18:00–21:30, 12 km | `DAY` 2.00h × 67.56 = **135.12** + `EVENING` 1.50h × 74.42 = **111.63** + `TRAVEL` 12 km × 0.97 = **11.64** → **258.39** |
| B | Tue 09:00–13:00 | `DAY` 4.00h × 67.56 = **270.24** |
| C | Sat 10:00–14:30 | `SATURDAY` 4.50h × 95.07 = **427.82** |
| D | Sun 08:00–12:00 | `SUNDAY` 4.00h × 122.59 = **490.36** |
| E | Public holiday 09:00–12:00 | `HOLIDAY` 3.00h × 150.12 = **450.36** |
| F | Fri 22:00 → Sat 01:00 | `EVENING` 2.00h × 74.42 = 148.84 + `SATURDAY` 1.00h × 95.07 = 95.07 → **243.91** |
| G | Thu 23:00 → Fri 02:00 (Fri = holiday) | `EVENING` 1.00h × 74.42 = 74.42 + `HOLIDAY` 2.00h × 150.12 = 300.24 → **374.66** |
| H | Agreed rate 60.00, weekday 09:00–11:00 | effective 60.00 → 2.00 × 60.00 = **120.00** |
| I | Agreed rate 80.00, weekday 09:00–11:00 | capped at 67.56 → 2.00 × 67.56 = **135.12** |

#### 4.6 Timezone & Daylight Saving (MANDATORY)
- Additive field `Business.timezone` (default `Australia/Sydney`), derived from `Business.state` (NSW/ACT→`Australia/Sydney`, VIC→`Australia/Melbourne`, QLD→`Australia/Brisbane`, SA→`Australia/Adelaide`, WA→`Australia/Perth`, TAS→`Australia/Hobart`, NT→`Australia/Darwin`).
- Use **luxon**. `Date.getUTCDay()` / `getDay()` must never be used for tier decisions.
- **Duration** comes from the absolute UTC difference (DST-correct); **tier** comes from the local wall clock. Spring-forward 01:00→04:00 = **2.0 real hours**; fall-back 01:00→04:00 = **4.0 real hours**.
- The same engine output drives both the on-screen preview and the stored values.

#### 4.7 Public Holiday Detection
1. **Auto:** `date-holidays` package initialised per business state (`new Holidays('AU', state)`) — free, offline, handles substitute days.
2. **Manual override:** flag `isPublicHoliday: true|false` — `true` forces `HOLIDAY`, `false` forces a normal tier. Omitted = auto.
3. Persist `isPublicHoliday`, `publicHolidayName`, `holidaySource` (`AUTO` | `MANUAL` | `NOT_HOLIDAY`) and expose them in responses.

#### 4.8 Calculation Engine (`src/shifts/shift.engine.ts`)
- **Pure + deterministic:** no DB, no network, no `Date.now()`; rate table and holiday facts are arguments.
- **Input:** `{ date, startTime, endTime, travelKms?, timezone, isPublicHoliday? }` + resolved `RateTable`.
- **Output:** ordered `CalculatedLine[]` (tier, item code, description, quantity, unit, `ndisCapRate`, `appliedRate`, `amount`, `segmentStart/End`, `sortOrder`) + `totalHours`, `travelKms`, `grandTotal`, holiday facts, `startAt`/`endAt`.
- **Algorithm:** validate → build local start/end (end on the next day when `endTime <= startTime`) → absolute duration → duration guards → segment walk splitting at `00:00` and weekday `20:00` → per-segment tier → `round2` lines → merge adjacent identical-tier lines → append travel line → totals.
- **Description templates:** `"Weekday Daytime Support (HH:mm - HH:mm)"`, `"Weekday Evening Support (HH:mm - HH:mm)"`, `"Saturday Support (…)"`, `"Sunday Support (…)"`, `"Public Holiday Support (…)"`, `"Activity-Based Transport (N km @ $R/km)"`.
- **Engine errors:** `SHIFT_TIME_FORMAT_INVALID`, `SHIFT_DATE_INVALID`, `SHIFT_DURATION_INVALID`, `SHIFT_DURATION_TOO_LONG`, `TRAVEL_KM_INVALID`, `TRAVEL_NOT_ALLOWED_FOR_ITEM`, `SUPPORT_CATALOGUE_INCOMPLETE`.
- **Test matrix:** 22 mandatory cases (19:59/20:00/20:01 boundaries, weekend, holiday auto+manual, three overnight variants, agreed-rate above/below cap, travel allowed/forbidden/zero, 13 h warning, 17 h block, DST both directions, merged segments, missing catalogue row).

#### 4.9 Approved Decisions (DO NOT RE-LITIGATE)

| # | Decision | Behaviour |
| :--- | :--- | :--- |
| D1 | Shift editing | Allowed while `PENDING`; **forbidden once invoiced** (`409 SHIFT_ALREADY_INVOICED`) |
| D2 | Budget overrun | **Warn, never block** (`warnings: ['BUDGET_EXHAUSTED']`) |
| D3 | Sleepover / night flat item | **Deferred to v2** — needs the official catalogue code + rate |
| D4 | Rate source | `NdisSupportItem` catalogue only |
| D5 | Agreed rate vs cap | `min(agreed, cap)` on time tiers |
| D6 | Early-morning hours | 00:00–06:00 = `DAY` rate |
| D7 | Overnight | Split at local midnight, tier per day |
| D8 | Timezone | Business timezone + luxon + DST aware |
| D9 | Holidays | `date-holidays` (state) + manual override |
| D10 | Voice gating | Pro only; trial = 3 parses |
| D11 | Audio retention | Never stored (memory only) |
| D12 | AI output | Preview only; worker confirms |
| D13 | AI privacy | First name only; no surnames/NDIS numbers |
| D14 | Delete | Soft cancel (`status = CANCELLED`, `cancelledAt`); row preserved |
| D15 | Invoiced shift | Immutable |
| D16 | Rate snapshot | `appliedRate` + `ndisCapRate` stored per line |
| D17 | Dashboard | Single `GET /dashboard/summary` endpoint |
| D18 | Budget update | Recomputed on shift create/edit/cancel |
| D19 | Double-submit | Optional `Idempotency-Key` header, unique per business |
| D20 | Client change on edit | Not allowed (delete + re-create) |

#### 4.10 API Endpoints

| Method | Endpoint | Roles | Purpose |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/shifts` | OWNER, OFFICE_MANAGER, TECHNICIAN | Log shift → run engine → persist shift + line items → return preview, budget block, warnings |
| `GET` | `/api/v1/shifts` | all (TECHNICIAN = own only) | Paginated list + filters (`from`, `to`, `clientId`, `userId`, `status`, `isInvoiced`, `sort`, `order`) + `summary` totals |
| `GET` | `/api/v1/shifts/:id` | all (TECHNICIAN = own only) | Detail with `lineItems` |
| `PATCH` | `/api/v1/shifts/:id` | all (TECHNICIAN = own only) | Edit `PENDING` shift; re-runs the engine; re-creates line items |
| `DELETE` | `/api/v1/shifts/:id` | all (TECHNICIAN = own only) | Soft cancel; forbidden when invoiced |
| `GET` | `/api/v1/shifts/uninvoiced` | all (TECHNICIAN = own only) | `PENDING` shifts grouped by participant with totals (Module 5 batch invoicing) |
| `POST` | `/api/v1/shifts/voice-parse` | all (plan-gated) | Audio → transcript → structured JSON preview (never saves) |
| `GET` | `/api/v1/dashboard/summary` | all (TECHNICIAN = own only) | Weekly earnings + % change, uninvoiced totals, active participants, 5 recent shifts, budget watch, trial usage |

#### 4.11 Voice-to-JSON Shift Extractor (`src/shifts/voice-parser.ts`)
- **Flow:** `multipart/form-data` (`file`, max **5 MB**) → in-memory buffer → **Groq Whisper** (`whisper-large-v3`, `language: en`, `temperature: 0`) → **Gemini Flash** structured JSON (`temperature: 0`, JSON schema enforced) → Zod validation → server-side client matching → preview response.
- **Extracted schema:** `{ clientFirstName, shiftDate, startTime, endTime, travelKms, caseNotes, confidence, missingFields[] }`.
- **Limits:** 60 s max audio; 10 requests/min/user and 30/day/user; accepted `audio/webm|ogg|mp4|mpeg|wav|x-m4a|aac`.
- **Privacy (mandatory):** audio never persisted; no surname/NDIS number/address/DOB sent to any provider; 9-digit sequences redacted from the transcript and from `caseNotes`; audit stores only non-sensitive metadata (`SHIFT_VOICE_PARSED`).
- **Client matching:** exact → prefix → candidates list (max 5). AI never receives or returns a `clientId`.
- **Human confirmation:** the endpoint **never creates a shift**; the UI prefills the form and the worker submits via `POST /shifts`.
- **Fallback:** provider timeout (`504`) → manual form stays usable; missing AI keys → server still boots, endpoint returns `503 VOICE_UNAVAILABLE`.
- **iPhone compatibility:** the frontend must fall back to `audio/mp4` when `MediaRecorder.isTypeSupported('audio/webm')` is false.

#### 4.12 Plan Gating & Trial Limits (Module 4)
| Capability | Trial | Starter | Pro |
| :--- | :--- | :--- | :--- |
| Manual shifts | **5 total** | unlimited | unlimited |
| Voice AI parses | **3 total** | ❌ blocked | unlimited |

- `checkTrialResourceLimit` gains the `'voice'` resource type, counting `SHIFT_VOICE_PARSED` audit events (deleting shifts cannot reset usage).
- Error codes: `403 TRIAL_SHIFT_LIMIT_REACHED`, `403 TRIAL_VOICE_LIMIT_REACHED`, `403 VOICE_PLAN_REQUIRED`, `402 TRIAL_EXPIRED` (existing).
- Gating uses `Business.planTier` (`TRIAL` / `STARTER` / `PRO`), which Module 5 updates on subscription.

#### 4.13 Budget Tracking (Module 3 integration)
- `Client.allocatedBudgetSpent` = sum of `totalAmount` of that client's **non-cancelled** shifts (`PENDING` + `INVOICED`); recomputed via an exported helper `recalculateClientBudgetSpent(clientId, businessId)` after every shift create/edit/cancel (idempotent, drift-free).
- Thresholds returned to the client: `< 70%` = `OK`, `70–99%` = `WARNING`, `>= 100%` = `EXHAUSTED` (amber `#F59E0B`, red `#EF4444`).
- Never blocks (decision D2).

#### 4.14 Validation & Safety Guards
- **Date:** future dates rejected (`SHIFT_DATE_IN_FUTURE`); backdating window **90 days** (`SHIFT_DATE_TOO_OLD`).
- **Duration:** `> 16 h` rejected (`SHIFT_DURATION_TOO_LONG`); `> 12 h` accepted with `LONG_SHIFT_WARNING`.
- **Travel:** `> 500 km` or negative rejected (`TRAVEL_KM_INVALID`); travel on an item with `isTravelAllowed = false` rejected (`TRAVEL_NOT_ALLOWED_FOR_ITEM`).
- **Overlap:** same worker with an overlapping non-cancelled shift → `409 SHIFT_OVERLAP` (conflicting id in `details`).
- **Duplicate:** same worker + client + `startAt` → `409 DUPLICATE_SHIFT`.
- **Idempotency:** `Idempotency-Key` replay returns the original shift (`200`), never a second row.
- **Immutability:** invoiced shifts cannot be edited or deleted; cancelled shifts cannot be edited.
- Every mutation is tenant-scoped (`businessId`) and audit-logged.

#### 4.15 Audit Events
| Event | Metadata (never sensitive) |
| :--- | :--- |
| `SHIFT_LOGGED` | `shiftId, clientId, supportItemCode, totalHours, travelKms, totalAmount, rateTiers[], isPublicHoliday, holidaySource, voiceAssisted, idempotentReplay` |
| `SHIFT_UPDATED` | `shiftId, changedFields[], oldTotalAmount, newTotalAmount` |
| `SHIFT_DELETED` | `shiftId, clientId, cancelledTotalAmount` |
| `SHIFT_VOICE_PARSED` | `matched, clientCandidatesCount, confidenceBucket, missingFieldsCount, ndisNumberRedacted` |

#### 4.16 Out of Scope for v1 (v2 backlog — DO NOT BUILD)
1. **Night-time sleepover** flat item (requires the official NDIS item code + rate from the Support Catalogue — a guessed code causes plan-manager rejection).
2. Short-notice **cancellation** claims.
3. **PRODA / Myplace CSV** export.
4. Offline shift queue (PWA background sync).
5. Billing-increment rounding modes (15-minute blocks).
6. Remote / Very Remote price regions (v1 uses National rates).
7. Plan-manager payment reminders.

#### 4.17 Environment Variables (additions)
```bash
GROQ_API_KEY="gsk_..."      # console.groq.com — Whisper transcription (free tier)
GEMINI_API_KEY="AIza..."    # aistudio.google.com — structured JSON extraction (free tier)
```

---

### 📌 MODULE 5: INVOICING, AUTO-REJECTION SHIELD & PLAN MANAGER DISPATCH

#### 5.1 Problem & Business Purpose
Plan Managers reject invoices for minor errors (e.g. charging $70/hr when the cap is $67.56, missing NDIS numbers, or wrong format). Rejections delay payments by 3 to 6 weeks, crippling sole traders' cashflow.

The **Pre-Flight Auto-Rejection Shield** blocks invalid invoices before generation and guarantees 100% first-pass acceptance.

#### 5.2 Pre-Flight Auto-Rejection Shield Validator (`src/invoices/validator.ts`)

```typescript
export interface PreFlightCheckInput {
  businessAbn?: string | null;
  businessBsb?: string | null;
  businessAccount?: string | null;
  participantNdisNumber: string;
  planManagerEmail: string | null;
  planManagementType: string;
  items: Array<{ code: string; unitPrice: number; quantity: number }>;
  rateLimitsMap: Record<string, number>; // Official 2026 price caps
}

export function validateInvoiceBeforeDispatch(data: PreFlightCheckInput): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Business Banking & Tax Checks (ATO Compliance)
  if (!data.businessAbn || data.businessAbn.length !== 11) {
    errors.push('ATO Requirement: Business ABN is missing or invalid (must be 11 numeric digits).');
  }
  if (!data.businessBsb || !/^\d{3}-?\d{3}$/.test(data.businessBsb)) {
    errors.push('Banking Error: Valid Australian BSB (XXX-XXX) required for EFT payment.');
  }
  if (!data.businessAccount || data.businessAccount.length < 6) {
    errors.push('Banking Error: Valid Bank Account number required.');
  }

  // 2. Participant 9-digit NDIS Number Validation
  const cleanNdis = data.participantNdisNumber.replace(/\s/g, '');
  if (!/^\d{9}$/.test(cleanNdis)) {
    errors.push('NDIA Compliance Error: Participant NDIS Number must be exactly 9 digits.');
  }

  // 3. Plan Manager Email Routing Check
  if (data.planManagementType === 'PLAN_MANAGED') {
    if (!data.planManagerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.planManagerEmail)) {
      errors.push('Dispatch Error: Plan Manager agency claims email address is missing or invalid.');
    }
  }

  // 4. Zero-Tolerance NDIA Price Cap Enforcement
  for (const item of data.items) {
    const maxCap = data.rateLimitsMap[item.code];
    if (maxCap && item.unitPrice > maxCap) {
      errors.push(
        `NDIA Price Cap Violation: Item ${item.code} charged at $${item.unitPrice}, but 2026 price limit is $${maxCap}.`
      );
    }
    if (item.quantity <= 0) {
      errors.push(`Invalid line item quantity (${item.quantity}) for item ${item.code}.`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
```

#### 5.3 Automated Invoicing & PDF Dispatch Flow

1. **Batch Shift Selection:** Sole trader selects 1 or more uninvoiced shifts for a client.
2. **Pre-Flight Validation:** Shield runs in memory. If any error exists, invoice generation is rejected with detailed error list.
3. **Sequential Invoice Generation:** Backend computes next sequential number (e.g. `INV-2026-0042`), calculates subtotal, sets `gstAmount = 0.00`, creates `Invoice` and `InvoiceLineItem` rows in Prisma `$transaction`, and marks shifts as `isInvoiced = true`.
4. **PDF Tax Invoice Generation:** Generates pixel-perfect Australian standard Tax Invoice PDF containing:
   - Header: Business Name, ABN, Email, Phone.
   - Bill To: Participant Full Name & 9-digit NDIS ID.
   - Payee: Plan Manager Agency Name & Billing Email.
   - Bank EFT: Bank Name, BSB, Account Number, Account Name.
   - Line Items Table: Shift Date, NDIS Item Code, Description, Hours/KMs, Hourly Rate, Line Total.
   - Footer: "NDIS Core Supports - GST Free per Section 38-38 of A New Tax System (GST) Act 1999".
5. **Direct Email Dispatch via Resend:**
   - Sends email directly to `invoices@myplanmanager.com.au` with PDF attachment.
   - BCCs the sole trader's registered business email.
   - Updates invoice status to `SENT` with timestamp `sentAt = new Date()`.

---

## 5. COMPLETE REST API ROUTE DEFINITIONS

All routes require `Authorization: Bearer <accessToken>` header unless marked public.

```
Base URL: /api/v1 (and backward-compatible /api)

Module 1: Authentication & Session
POST   /auth/register              # Register business & owner (starts 9-day trial)
POST   /auth/login                 # Email/password authentication
POST   /auth/google                # Google OAuth 2.0 verification & provisioning
POST   /auth/refresh               # Rotate refresh token (from HttpOnly cookie)
POST   /auth/logout                # Revoke session & clear cookie
POST   /auth/forgot-password       # Send single-use reset link
POST   /auth/reset-password        # Complete password reset

Module 2: Business Profile & Bank Details
GET    /business/profile           # Retrieve business profile, ABN, BSB, trial status
PUT    /business/profile           # Update business details, ABN, BSB, bank account (Owner only)

Module 3: NDIS Clients & Plan Managers
GET    /clients                    # List all participants with search, filter, and budget stats
POST   /clients                    # Create participant profile with 9-digit NDIS check
GET    /clients/:id                # Retrieve participant detail & recent shift history
PUT    /clients/:id                # Update participant or plan manager email
DELETE /clients/:id                # Soft-delete participant

Module 4: Shift Logging & Auto-Split Engine
POST   /shifts                     # Log shift, run deterministic NDIS split, persist shift + line items
GET    /shifts                     # List shift history (from/to/clientId/userId/status + pagination + summary)
GET    /shifts/:id                 # Shift detail with rate-split line items
PATCH  /shifts/:id                 # Edit a PENDING shift (re-runs the split); forbidden once invoiced
DELETE /shifts/:id                 # Soft-cancel a shift (row preserved); forbidden once invoiced
GET    /shifts/uninvoiced          # PENDING shifts grouped by participant (Module 5 batch invoicing)
POST   /shifts/voice-parse         # Audio -> Groq Whisper -> Gemini JSON preview (plan-gated, never saves)
GET    /dashboard/summary          # Weekly earnings, uninvoiced totals, budget watch, recent shifts

Module 5: Invoicing & Shield Dispatch
POST   /invoices/generate          # Validate via Shield, build PDF, save to DB & dispatch email
GET    /invoices                   # List all invoices (DRAFT, SENT, PAID, REJECTED)
GET    /invoices/:id               # Retrieve invoice details & line items
GET    /invoices/:id/pdf           # Stream generated PDF tax invoice
POST   /invoices/:id/resend        # Re-dispatch PDF to Plan Manager email
POST   /invoices/:id/mark-paid     # Mark invoice as paid (records audit event)
```

---

## 6. ENVIRONMENT VARIABLES & SECRETS REFERENCE (`.env`)

```bash
# Server & Runtime
NODE_ENV="production"
PORT=5000
CLIENT_URL="https://www.rayvice.com"
CORS_ORIGIN="https://www.rayvice.com,https://rayvice.com,http://localhost:3000"

# Neon PostgreSQL Connection (Serverless pooling with SSL)
DATABASE_URL="postgresql://neondb_owner:***@ep-***.ap-southeast-2.aws.neon.tech/rayvice?sslmode=require"

# JWT Security Secrets (HMAC SHA-256)
JWT_ACCESS_SECRET="generate-64-character-random-hex-string-for-access-token"
JWT_REFRESH_SECRET="generate-64-character-random-hex-string-for-refresh-token"
ACCESS_TOKEN_TTL_MINUTES=15
REFRESH_TOKEN_TTL_DAYS=7

# Transactional Email to Plan Managers & Verification (Resend API)
RESEND_API_KEY="re_1234567890abcdef"
EMAIL_FROM="Rayvice Invoicing <invoices@rayvice.com>"

# AI Voice Transcription & Structured Shift Parsing (Groq + Gemini Free Tiers)
GROQ_API_KEY="gsk_abcdef123456"
GEMINI_API_KEY="AIzaSy1234567890"

# Australian Stripe Subscription Billing ($24 AUD/mo Basic, $44 AUD/mo Pro)
STRIPE_SECRET_KEY="sk_live_***"
STRIPE_WEBHOOK_SECRET="whsec_***"
STRIPE_PRICE_BASIC_AUD="price_***"
STRIPE_PRICE_PRO_AUD="price_***"
```

---

## 7. AI AGENT CODING RULES (MANDATORY & UNBREAKABLE)

1. **NO BUSINESS LOGIC GUESSING:** All rate calculations, time thresholds (20:00 split), and item codes MUST strictly follow Section 4.2.
2. **MULTI-TENANT ENFORCEMENT:** Every database query MUST filter by `businessId: req.user.businessId`. Never perform a bare `findMany()` without a tenant scope.
3. **PRE-FLIGHT VALIDATION BEFORE INVOICING:** Never write an invoice to the database without first executing `validateInvoiceBeforeDispatch()`.
4. **DECIMAL PRECISION:** All currency fields MUST use `@db.Decimal(10, 2)` and rounded to 2 decimal places to prevent floating-point rounding errors on tax invoices.
5. **IMMUTABLE AUDIT LOGS:** Always call `recordAuditEvent()` on every create, update, delete, invoice generation, and dispatch operation.

