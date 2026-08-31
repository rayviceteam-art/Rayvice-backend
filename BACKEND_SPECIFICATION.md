# 🚀 NDIS SOLE-TRADER BILLING & COMPLIANCE SAAS
## BACKEND ENGINEERING SPECIFICATION & ARCHITECTURE DOCUMENT

**Target Stack (LOCKED):**
* **Frontend:** Next.js (TypeScript, Tailwind CSS)
* **Backend:** Node.js, Express.js, TypeScript
* **Database:** PostgreSQL (Neon Serverless Postgres) via Prisma ORM
* **Auth Status:** ✅ **Module 1 (Auth, JWT, Business Tenant Foundation) is ALREADY IMPLEMENTED**
* **Target Audience:** Backend Developers, Full-Stack Engineers, AI Coding Agents
* **Target Market:** Australia (NDIS - National Disability Insurance Scheme)

---

## 1. SYSTEM ARCHITECTURE & CODEBASE INTEGRATION

This specification extends the existing Express.js + Prisma backend codebase (`Rayvice-backend`).

```mermaid
graph TD
    ClientApp[Next.js TypeScript Frontend] -->|Bearer JWT Token| ExpressAPI[Node.js + Express.js API]
    
    subgraph "Express Backend Architecture"
        AuthMW[authenticate Middleware] --> RateEngine[NDIS Calculation Engine]
        RateEngine --> ServiceLayer[Service & Repository Layer]
        ServiceLayer --> PrismaClient[Prisma ORM Client]
    end

    PrismaClient --> NeonDB[(Neon PostgreSQL Serverless)]
    ServiceLayer --> ResendAPI[Resend Email API]
    ServiceLayer --> GroqGemini[Groq Whisper / Gemini Flash AI]
    ServiceLayer --> StripeAPI[Stripe Billing & Webhooks]
    
    ResendAPI -->|Direct PDF Dispatch| PlanManager([NDIS Plan Manager Agency])
```

---

## 2. MODULAR ROADMAP (EXISTING + 4 CORE BUSINESS MODULES)

| Module | Status | Scope / Responsibility |
| :--- | :--- | :--- |
| **Module 1: Auth & Tenant Foundation** | ✅ **DONE** | User registration, login, JWT refresh tokens, multi-tenant `Business` and `User` models, audit logs. |
| **Module 2: Business Profile & NDIS Billing Config** | 🔨 **TODO** | ABN (11 digits), BSB & Bank Account details, default support codes, invoice prefix settings. |
| **Module 3: NDIS Participant & Plan Manager Directory** | 🔨 **TODO** | Client records, 9-digit NDIS IDs, Plan Manager agency email routing, allocated budget caps. |
| **Module 4: Shift Logging & Auto-Split Engine** | 🔨 **TODO** | Voice/Text shift ingestion, 2026 NDIA catalogue lookup, day/evening/weekend/holiday split logic, travel km calculation. |
| **Module 5: Invoicing, Auto-Rejection Shield & Dispatch** | 🔨 **TODO** | Pre-flight validation, PDF generation, Resend direct dispatch to Plan Managers, Stripe subscription gating. |

---

## 3. PRISMA SCHEMA EXTENSION (`prisma/schema.prisma`)

Add the following models to the existing `prisma/schema.prisma` file in `Rayvice-backend`:

```prisma
// =============================================================================
// NDIS Support Catalogue (Official Australian Government Price Limits)
// =============================================================================
model NdisSupportItem {
  itemNumber             String   @id @map("item_number") // e.g. "01_011_0107_1_1"
  supportItemName        String   @map("support_item_name")
  categoryName           String   @map("category_name")
  unit                   String   @default("Hour") // "Hour", "Each", "KM"
  nationalWeekdayRate    Decimal  @map("national_weekday_rate") @db.Decimal(10, 2) // e.g. 67.56
  nationalEveningRate    Decimal? @map("national_evening_rate") @db.Decimal(10, 2) // e.g. 74.42 (after 8:00 PM)
  nationalSaturdayRate   Decimal? @map("national_saturday_rate") @db.Decimal(10, 2) // e.g. 95.07
  nationalSundayRate     Decimal? @map("national_sunday_rate") @db.Decimal(10, 2) // e.g. 122.59
  nationalHolidayRate    Decimal? @map("national_holiday_rate") @db.Decimal(10, 2) // e.g. 150.12
  isTravelAllowed        Boolean  @default(true) @map("is_travel_allowed")
  effectiveFrom          DateTime @map("effective_from")
  effectiveTo            DateTime? @map("effective_to")

  clients                Client[]

  @@map("ndis_support_items")
}

// =============================================================================
// NDIS Clients (Participants)
// =============================================================================
enum PlanManagementType {
  PLAN_MANAGED
  SELF_MANAGED
  NDIA_MANAGED
}

model Client {
  id                     String             @id @default(uuid())
  businessId             String             @map("business_id")
  participantName        String             @map("participant_name")
  ndisNumber             String             @map("ndis_number") // 9 digits, e.g. "430123456"
  dateOfBirth            DateTime?          @map("date_of_birth")
  planManagementType     PlanManagementType @default(PLAN_MANAGED) @map("plan_management_type")
  planManagerAgencyName  String?            @map("plan_manager_agency_name") // e.g. "My Plan Manager"
  planManagerEmail       String?            @map("plan_manager_email") // e.g. "invoices@myplanmanager.com.au"
  hourlyRateAgreed       Decimal?           @map("hourly_rate_agreed") @db.Decimal(10, 2)
  defaultSupportItemCode String?            @map("default_support_item_code")
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

// =============================================================================
// Shifts (Daily Work Logs)
// =============================================================================
model Shift {
  id             String    @id @default(uuid())
  businessId     String    @map("business_id")
  userId         String    @map("user_id") // Worker who logged the shift
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

// =============================================================================
// Invoices (Australian Compliant NDIS Tax Invoices)
// =============================================================================
enum InvoiceStatus {
  DRAFT
  SENT
  PAID
  REJECTED
  CANCELLED
}

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
  quantity        Decimal  @map("quantity") @db.Decimal(6, 2) // Hours or KMs
  unitPrice       Decimal  @map("unit_price") @db.Decimal(10, 2)
  totalAmount     Decimal  @map("total_amount") @db.Decimal(10, 2)

  createdAt       DateTime @default(now()) @map("created_at")

  invoice         Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@map("invoice_line_items")
}
```

*(Note: Also add `abn`, `bsb`, `accountNumber` to the existing `Business` model in `schema.prisma`).*

---

## 4. DIRECTORY STRUCTURE IN `Rayvice-backend`

```
Rayvice-backend/src/
├── app.ts                  # Main Express application router configuration
├── server.ts               # Server bootstrap & port listener
├── config/
│   ├── env.ts              # Environment variables schema & validation (Zod)
│   └── prisma.ts           # Shared PrismaClient instance
├── middleware/
│   ├── authenticate.ts     # Existing JWT authentication middleware (extracts req.user)
│   ├── rateLimiter.ts      # Rate limiting
│   └── errorHandler.ts     # Centralized error handler
├── auth/                   # [EXISTING] Auth controllers & services
├── business/               # [EXISTING + EXTENDED] Profile, ABN & Bank Details
├── clients/                # [MODULE 3] NDIS Clients & Plan Managers
│   ├── client.routes.ts
│   ├── client.controller.ts
│   ├── client.service.ts
│   └── client.validators.ts
├── shifts/                 # [MODULE 4] Shift Logging & Auto-Split Engine
│   ├── shift.routes.ts
│   ├── shift.controller.ts
│   ├── shift.service.ts
│   ├── shift.engine.ts     # Deterministic NDIS rate & time-splitting math
│   └── voice-parser.ts     # Groq Whisper / Gemini JSON extractor
├── invoices/               # [MODULE 5] Invoicing & Auto-Rejection Shield
│   ├── invoice.routes.ts
│   ├── invoice.controller.ts
│   ├── invoice.service.ts
│   ├── validator.ts        # Pre-Flight Auto-Rejection Shield
│   └── pdf-generator.ts    # PDF render engine
└── integrations/
    ├── resend.service.ts   # Plan Manager email dispatch
    └── stripe.service.ts   # Stripe Checkout & Webhooks
```

---

## 5. CORE BUSINESS LOGIC IMPLEMENTATION (EXPRESS & TYPESCRIPT)

### 5.1 Deterministic NDIS Split-Shift Engine (`src/shifts/shift.engine.ts`)

```typescript
import { Decimal } from '@prisma/client/runtime/library';

export interface ShiftCalculationInput {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "18:00"
  endTime: string; // "21:30"
  travelKms?: number;
  isPublicHoliday?: boolean;
}

export interface CalculatedItem {
  supportItemCode: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export function calculateNdisShiftSplit(
  input: ShiftCalculationInput,
  rates: {
    weekdayDayRate: number; // e.g. 67.56
    weekdayEveningRate: number; // e.g. 74.42 (after 20:00)
    saturdayRate: number; // e.g. 95.07
    sundayRate: number; // e.g. 122.59
    holidayRate: number; // e.g. 150.12
    travelKmRate: number; // e.g. 0.97
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

  // 1. PUBLIC HOLIDAY
  if (input.isPublicHoliday) {
    items.push({
      supportItemCode: '01_012_0107_1_1',
      description: `Public Holiday Support (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.holidayRate,
      total: Number((totalHours * rates.holidayRate).toFixed(2)),
    });
  } 
  // 2. SUNDAY
  else if (dayOfWeek === 0) {
    items.push({
      supportItemCode: '01_013_0107_1_1',
      description: `Sunday Support (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.sundayRate,
      total: Number((totalHours * rates.sundayRate).toFixed(2)),
    });
  } 
  // 3. SATURDAY
  else if (dayOfWeek === 6) {
    items.push({
      supportItemCode: '01_014_0107_1_1',
      description: `Saturday Support (${input.startTime} - ${input.endTime})`,
      quantity: totalHours,
      unitPrice: rates.saturdayRate,
      total: Number((totalHours * rates.saturdayRate).toFixed(2)),
    });
  } 
  // 4. WEEKDAY (Check for 8:00 PM / 20:00 Threshold Split)
  else {
    const EVENING_THRESHOLD = 20.0; // 8:00 PM

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
      // Automatic split
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
      description: `Activity Based Transport (${input.travelKms} km @ $${rates.travelKmRate}/km)`,
      quantity: input.travelKms,
      unitPrice: rates.travelKmRate,
      total: Number((input.travelKms * rates.travelKmRate).toFixed(2)),
    });
  }

  return items;
}
```

---

### 5.2 Auto-Rejection Shield Pre-Flight Validator (`src/invoices/validator.ts`)

```typescript
export interface PreFlightCheckResult {
  isValid: boolean;
  errors: string[];
}

export function validateInvoiceBeforeDispatch(data: {
  participantNdisNumber: string;
  planManagerEmail: string | null;
  planManagementType: string;
  items: Array<{ code: string; unitPrice: number }>;
  rateLimitsMap: Record<string, number>;
}): PreFlightCheckResult {
  const errors: string[] = [];

  // 1. Strict 9-digit NDIS Number validation
  const cleanNdis = data.participantNdisNumber.replace(/\s/g, '');
  if (!/^\d{9}$/.test(cleanNdis)) {
    errors.push('Invalid NDIS Number: Must be exactly 9 numeric digits (e.g. 430123456).');
  }

  // 2. Plan Manager Email validation (if Plan-Managed)
  if (data.planManagementType === 'PLAN_MANAGED') {
    if (!data.planManagerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.planManagerEmail)) {
      errors.push('Missing or invalid Plan Manager agency email address.');
    }
  }

  // 3. Price Cap Violation Check (Zero tolerance)
  for (const item of data.items) {
    const maxCap = data.rateLimitsMap[item.code];
    if (maxCap && item.unitPrice > maxCap) {
      errors.push(
        `NDIA Price Cap Exceeded: Item ${item.code} is charged at $${item.unitPrice}, but 2026 limit is $${maxCap}.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
```

---

## 6. REST API ROUTES SPECIFICATION (EXPRESS.JS)

### 6.1 Clients API (`/api/v1/clients`)
* `POST /api/v1/clients` — Create a new NDIS client profile (Protected).
* `GET /api/v1/clients` — List all active clients for the authenticated business.
* `GET /api/v1/clients/:id` — Get client detail with pending uninvoiced shift count.
* `PUT /api/v1/clients/:id` — Update client / Plan Manager details.
* `DELETE /api/v1/clients/:id` — Soft-delete client (`deletedAt = now()`).

### 6.2 Shifts API (`/api/v1/shifts`)
* `POST /api/v1/shifts` — Log a shift. Returns preview of auto-split line items.
* `POST /api/v1/shifts/voice-parse` — Ingest raw voice transcript and extract structured shift JSON via Gemini Flash.
* `GET /api/v1/shifts/uninvoiced` — Get all un-invoiced shifts grouped by client.
* `DELETE /api/v1/shifts/:id` — Delete un-invoiced shift.

### 6.3 Invoices API (`/api/v1/invoices`)
* `POST /api/v1/invoices/generate` — Generate invoice from array of `shiftIds`. Executes Pre-Flight Validator, generates PDF, and sends to Plan Manager via Resend API.
* `GET /api/v1/invoices` — List all invoices with status (`DRAFT`, `SENT`, `PAID`).
* `GET /api/v1/invoices/:id/pdf` — Stream or download generated PDF.
* `POST /api/v1/invoices/:id/mark-paid` — Mark invoice as paid.

---

## 7. EXPRESS APP INTEGRATION (`src/app.ts`)

In `Rayvice-backend/src/app.ts`, register the new routes:

```typescript
import clientRoutes from './clients/client.routes';
import shiftRoutes from './shifts/shift.routes';
import invoiceRoutes from './invoices/invoice.routes';

// Register routes in createApp()
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1/shifts', shiftRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
```

---

## 8. 100% ZERO-COST ENVIRONMENT CONFIGURATION (`.env`)

```bash
# Neon PostgreSQL (Already configured in existing backend)
DATABASE_URL="postgresql://neondb_owner:***@ep-***.ap-southeast-2.aws.neon.tech/rayvice?sslmode=require"

# JWT Auth (Already configured)
JWT_SECRET="your-super-secret-jwt-key"
JWT_REFRESH_SECRET="your-super-secret-refresh-key"

# AI Voice & Transcription (Groq Whisper / Gemini Flash - Free Tiers)
GROQ_API_KEY="gsk_..."
GEMINI_API_KEY="AIzaSy..."

# Transactional Email to Plan Managers (Resend - Free Tier 3,000 emails/mo)
RESEND_API_KEY="re_..."

# Australian Stripe Subscriptions ($24 AUD/mo)
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
```

---

## 9. STEP-BY-STEP IMPLEMENTATION CHECKLIST

- [ ] **Step 1:** Copy Section 3 models into `Rayvice-backend/prisma/schema.prisma` and run `npx prisma db push`.
- [ ] **Step 2:** Seed `NdisSupportItem` table with official 2026 NDIS Price Guide rates.
- [ ] **Step 3:** Implement `shift.engine.ts` and unit test time-splitting rules.
- [ ] **Step 4:** Build `client.routes.ts` & `shift.routes.ts` controllers with Zod validation.
- [ ] **Step 5:** Implement `validator.ts` and `resend.service.ts` for automated Plan Manager invoice delivery.
- [ ] **Step 6:** Connect Next.js frontend to Express API routes using the existing `api-client.ts`.

---
**Document Status:** 100% Complete & Locked to `Node.js + Express.js + TypeScript + Neon PostgreSQL`. Ready for immediate coding.
