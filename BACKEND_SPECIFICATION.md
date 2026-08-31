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
| **Module 1** | ✅ **DONE** | **Auth & Tenant Foundation** | Multi-tenant user registration, secure session tokens, brute-force lockout, Google OAuth. | `/api/v1/auth/*` |
| **Module 2** | 🔨 **TODO** | **Business Profile & Bank Details** | Australian ABN (11 digits), BSB (`XXX-XXX`), Bank Account, custom invoice prefixes, GST settings. | `/api/v1/business/profile`, `/api/v1/business/bank-details` |
| **Module 3** | 🔨 **TODO** | **NDIS Participant Directory** | 9-digit NDIS validation, Plan Management routing (Plan-Managed vs Self-Managed), budget caps. | `/api/v1/clients/*` |
| **Module 4** | 🔨 **TODO** | **Shift Logging & Auto-Split Engine** | Voice/Text shift intake, 8:00 PM evening rate threshold split, weekend/holiday rates, travel km math. | `/api/v1/shifts/*`, `/api/v1/shifts/voice-parse` |
| **Module 5** | 🔨 **TODO** | **Invoicing, Shield & Dispatch** | Pre-Flight Auto-Rejection Shield, compliant PDF generation, direct Plan Manager email delivery, Stripe gating. | `/api/v1/invoices/*`, `/api/v1/invoices/generate` |

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
  SHIFT_DELETED
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
  id             String    @id @default(uuid())
  businessId     String    @map("business_id")
  userId         String    @map("user_id")
  clientId       String    @map("client_id")
  shiftDate      DateTime  @map("shift_date") @db.Date
  startTime      String    @map("start_time") // "18:00"
  endTime        String    @map("end_time") // "21:30"
  totalHours     Decimal   @map("total_hours") @db.Decimal(5, 2)
  travelKms      Decimal   @default(0.0) @map("travel_kms") @db.Decimal(6, 2)
  travelMinutes  Int       @default(0) @map("travel_minutes")
  caseNotes      String?   @map("case_notes") @db.Text
  isInvoiced     Boolean   @default(false) @map("is_invoiced")
  invoiceId      String?   @map("invoice_id")

  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  business       Business  @relation(fields: [businessId], references: [id], onDelete: Cascade)
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  client         Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  invoice        Invoice?  @relation(fields: [invoiceId], references: [id], onDelete: SetNull)

  @@index([businessId, isInvoiced])
  @@index([clientId])
  @@map("shifts")
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
Australian sole traders require secure, isolated tenant spaces. Registration must automatically provision an enterprise-grade multi-tenant `Business` record and initialize a **3-day free trial** without requiring credit cards upfront.

#### 1.2 Key Mechanics & Architectural Rules
1. **Tenant Isolation:** Every operational table references `businessId`. All service queries MUST filter by `where: { businessId }`. Cross-tenant data leakage is impossible.
2. **Session Architecture:** 15-minute short-lived JWT access token returned in JSON payload + 7-day secure HttpOnly cookie containing SHA-256 hashed refresh token with automatic rotation and token-family revocation.
3. **Security Protections:** Argon2id/Bcrypt password hashing, 5 consecutive failed attempts trigger a 15-minute account lockout, single-use password reset tokens (1-hour TTL).
4. **Google OAuth 2.0:** Auto-provisions new business if user does not exist, or securely signs into existing business.

---

### 📌 MODULE 2: BUSINESS PROFILE, ABN & BANKING CONFIGURATION

#### 2.1 Problem & Business Purpose
Under the **Australian Taxation Office (ATO)** and **NDIA Invoicing Rules**, a tax invoice issued by a sole trader is invalid and immediately rejected by Plan Managers unless it contains:
- Valid 11-digit Australian Business Number (ABN).
- Valid 6-digit Bank State Branch (BSB) code and Account Number for direct EFT payment.
- GST registration indicator (NDIS core supports are generally GST-free, but invoice must state `$0.00 GST`).
- Sequential invoice numbering with configurable prefix.

#### 2.2 API Endpoints Specification

##### `GET /api/v1/business/profile`
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
    "bsb": "062-000",
    "accountNumber": "12345678",
    "bankName": "Commonwealth Bank",
    "invoicePrefix": "INV",
    "isGstRegistered": false,
    "status": "TRIALING",
    "trialEndsAt": "2026-09-03T12:00:00.000Z"
  }
}
```

##### `PUT /api/v1/business/profile`
- **Auth:** Required (`OWNER` role only).
- **Zod Validator:**
```typescript
export const updateBusinessProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(150).optional(),
    phone: z.string().trim().min(7).max(20).optional(),
    industry: z.string().trim().max(100).optional(),
    abn: z.string().trim().regex(/^\d{11}$/, 'ABN must be exactly 11 numeric digits.').optional(),
    bsb: z.string().trim().regex(/^\d{3}-?\d{3}$/, 'BSB must be 6 digits format (e.g. 062-000).').optional(),
    accountNumber: z.string().trim().min(6).max(9, 'Account number must be 6 to 9 digits.').optional(),
    bankName: z.string().trim().min(2).max(100).optional(),
    invoicePrefix: z.string().trim().min(1).max(10).default('INV').optional(),
    isGstRegistered: z.boolean().default(false).optional(),
  }),
});
```

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

#### 4.1 Problem & Business Purpose
The **NDIS Price Guide (2026 Limits)** mandates strict time-split rules based on shift hours:
- **Weekday Daytime (06:00 – 20:00):** Item `01_011_0107_1_1` (Cap: **$67.56/hr**).
- **Weekday Evening (After 20:00 / 8:00 PM):** Item `01_015_0107_1_1` (Cap: **$74.42/hr**).
- **Saturday:** Item `01_014_0107_1_1` (Cap: **$95.07/hr**).
- **Sunday:** Item `01_013_0107_1_1` (Cap: **$122.59/hr**).
- **Public Holiday:** Item `01_012_0107_1_1` (Cap: **$150.12/hr**).
- **Activity-Based Transport:** Item `01_799_0107_1_1` (**$0.97/km**).

If a support worker logs a shift from **18:00 to 21:30 (3.5 hours)**:
- 18:00 to 20:00 (2.0 hrs) = $67.56 × 2 = **$135.12**
- 20:00 to 21:30 (1.5 hrs) = $74.42 × 1.5 = **$111.63**
- 12 km Transport = $0.97 × 12 = **$11.64**
- **Total Shift Claim = $258.39 AUD**

Manually calculating this in Excel takes 5 hours a week and causes rejections. Rayvice automates this split instantly in milliseconds.

#### 4.2 Deterministic Calculation Engine Implementation (`src/shifts/shift.engine.ts`)

```typescript
export interface ShiftCalculationInput {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "18:00" (24h format)
  endTime: string; // "21:30" (24h format)
  travelKms?: number;
  isPublicHoliday?: boolean;
}

export interface CalculatedItem {
  supportItemCode: string;
  description: string;
  quantity: number; // hours or kms
  unitPrice: number;
  total: number;
}

export function calculateNdisShiftSplit(
  input: ShiftCalculationInput,
  rates: {
    weekdayDayRate: number; // 67.56
    weekdayEveningRate: number; // 74.42
    saturdayRate: number; // 95.07
    sundayRate: number; // 122.59
    holidayRate: number; // 150.12
    travelKmRate: number; // 0.97
  }
): CalculatedItem[] {
  const items: CalculatedItem[] = [];
  const shiftDate = new Date(input.date);
  const dayOfWeek = shiftDate.getUTCDay(); // 0 = Sunday, 6 = Saturday

  const [startH, startM] = input.startTime.split(':').map(Number);
  const [endH, endM] = input.endTime.split(':').map(Number);
  const startDecimal = startH + startM / 60;
  const endDecimal = endH + endM / 60;
  const totalHours = Number((endDecimal - startDecimal).toFixed(2));

  if (totalHours <= 0) {
    throw new Error('Shift end time must be after start time.');
  }

  // 1. PUBLIC HOLIDAY
  if (input.isPublicHoliday) {
    items.push({
      supportItemCode: '01_012_0107_1_1',
      description: `Public Holiday Assistance (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.holidayRate,
      total: Number((totalHours * rates.holidayRate).toFixed(2)),
    });
  } 
  // 2. SUNDAY
  else if (dayOfWeek === 0) {
    items.push({
      supportItemCode: '01_013_0107_1_1',
      description: `Sunday Assistance (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.sundayRate,
      total: Number((totalHours * rates.sundayRate).toFixed(2)),
    });
  } 
  // 3. SATURDAY
  else if (dayOfWeek === 6) {
    items.push({
      supportItemCode: '01_014_0107_1_1',
      description: `Saturday Assistance (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.saturdayRate,
      total: Number((totalHours * rates.saturdayRate).toFixed(2)),
    });
  } 
  // 4. WEEKDAY (Split at 20:00 / 8:00 PM)
  else {
    const EVENING_THRESHOLD = 20.0;

    if (endDecimal <= EVENING_THRESHOLD) {
      items.push({
        supportItemCode: '01_011_0107_1_1',
        description: `Weekday Daytime Support (${input.startTime} - ${input.endTime})`,
        quantity: totalHours,
        unitPrice: rates.weekdayDayRate,
        total: Number((totalHours * rates.weekdayDayRate).toFixed(2)),
      });
    } else if (startDecimal >= EVENING_THRESHOLD) {
      items.push({
        supportItemCode: '01_015_0107_1_1',
        description: `Weekday Evening Support (${input.startTime} - ${input.endTime})`,
        quantity: totalHours,
        unitPrice: rates.weekdayEveningRate,
        total: Number((totalHours * rates.weekdayEveningRate).toFixed(2)),
      });
    } else {
      const dayHours = Number((EVENING_THRESHOLD - startDecimal).toFixed(2));
      const eveningHours = Number((endDecimal - EVENING_THRESHOLD).toFixed(2));

      items.push({
        supportItemCode: '01_011_0107_1_1',
        description: `Weekday Daytime Support (${input.startTime} - 20:00)`,
        quantity: dayHours,
        unitPrice: rates.weekdayDayRate,
        total: Number((dayHours * rates.weekdayDayRate).toFixed(2)),
      });
      items.push({
        supportItemCode: '01_015_0107_1_1',
        description: `Weekday Evening Support (20:00 - ${input.endTime})`,
        quantity: eveningHours,
        unitPrice: rates.weekdayEveningRate,
        total: Number((eveningHours * rates.weekdayEveningRate).toFixed(2)),
      });
    }
  }

  // 5. ACTIVITY-BASED TRANSPORT
  if (input.travelKms && input.travelKms > 0) {
    items.push({
      supportItemCode: '01_799_0107_1_1',
      description: `Activity-Based Transport (${input.travelKms} km @ $${rates.travelKmRate}/km)`,
      quantity: input.travelKms,
      unitPrice: rates.travelKmRate,
      total: Number((input.travelKms * rates.travelKmRate).toFixed(2)),
    });
  }

  return items;
}
```

#### 4.3 Voice-to-JSON Shift Extractor (`src/shifts/voice-parser.ts`)
- Support workers tap the microphone button while in their car and say:  
  *"Worked with Sarah today from 6pm to 9:30pm, drove 12 kilometers to the community pool and did meal prep."*
- Backend ingests audio via Groq Whisper (`model: whisper-large-v3`) -> transcribes in <500ms -> passes transcript to Gemini Flash with strict JSON schema:
```json
{
  "clientName": "Sarah",
  "shiftDate": "2026-08-31",
  "startTime": "18:00",
  "endTime": "21:30",
  "travelKms": 12,
  "caseNotes": "Community access to local pool and evening meal preparation."
}
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
POST   /auth/register              # Register business & owner (starts 3-day trial)
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
POST   /shifts                     # Log shift & return live auto-split preview
POST   /shifts/voice-parse         # Ingest audio transcript & extract structured shift JSON
GET    /shifts/uninvoiced          # Get all uninvoiced shifts grouped by client
GET    /shifts                     # List shift history with date range filtering
DELETE /shifts/:id                 # Delete uninvoiced shift

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

