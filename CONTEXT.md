# Rayvice — Project Master Context

> **Last Updated**: August 31, 2026  
> **Status**: Module 1 Complete (Authentication, Multi-Tenant Foundation, Google OAuth 2.0 Integration)
> **Niche**: Australian NDIS Sole-Trader Billing & Compliance OS

---

## 1. Project Overview & Architecture

**Rayvice** is an automated billing, rate-splitting, and compliance management platform specifically designed for independent Australian NDIS Sole Traders (Support Workers, Cleaners, Independent Carers, Allied Health Assistants).

### Core Value Proposition
- Eliminates 100% of NDIS Plan Manager invoice rejections via an automated Pre-Flight Auto-Rejection Shield.
- Automates complex NDIS time-split rules (e.g. 8:00 PM evening rate threshold, Saturday/Sunday/Holiday loadings, travel allowances).
- Reduces weekly shift logging and invoice dispatch from 5 hours in Excel to under 30 seconds via Voice / 1-Tap entry.

### System Architecture
```
┌────────────────────────────────────────────────────────┐
│              Rayvice Frontend (Next.js)                │
│    Hosted on Vercel: https://www.rayvice.com           │
│    App Router • TailwindCSS • React Hot Toast • Lucide │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS / REST API
┌──────────────────────────▼─────────────────────────────┐
│              Rayvice Backend (Express + TS)            │
│    Hosted on Render: https://rayvice-backend.onrender.com
│    Prisma ORM • PostgreSQL • JWT Auth • Resend/SMTP    │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────┐
│          PostgreSQL Database (Neon / Multi-Tenant)     │
│    Tenant-isolated via businessId • Immutable Audits   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Tech Stack & Deployments

| Component | Technology | Production Deployment |
| :--- | :--- | :--- |
| **Frontend** | Next.js (App Router), React, TypeScript, Tailwind CSS | Vercel (`rayvice.com`, `www.rayvice.com`) |
| **Backend** | Node.js, Express, TypeScript, Prisma ORM, Zod | Render (`rayvice-backend.onrender.com`) |
| **Database** | PostgreSQL (Neon Serverless) | Neon PostgreSQL |
| **Authentication**| JWT (Access/Refresh Tokens), Google OAuth 2.0, Argon2id | Hybrid (Local + OAuth) |
| **Email Service** | SMTP / Resend API | Transactional Verification, Reset & Invoice Dispatch |
| **AI / Voice** | Groq Whisper + Gemini Flash | Voice-to-Shift Structured JSON Extraction |
| **Payments** | Stripe Subscriptions ($24 AUD/mo, $44 AUD/mo) | Stripe Checkout & Webhooks |

---

## 3. Database Schema & Multi-Tenancy

All records are strictly isolated by `businessId` (Tenant isolation).

### Module 1 Models (`prisma/schema.prisma` - Implemented):
- **`Business`**: The sole-trader / business tenant entity. Includes trial tracking (`trialStartedAt`, `trialEndsAt`, `hasUsedTrial`, `status`).
  - Statuses: `TRIALING`, `ACTIVE`, `READ_ONLY`, `SUSPENDED`
- **`User`**: Belongs to exactly 1 Business.
  - Roles: `OWNER`, `OFFICE_MANAGER`, `TECHNICIAN`
  - Statuses: `INVITED`, `ACTIVE`, `SUSPENDED`
- **`RefreshToken`**: Secure SHA-256 hashed refresh tokens with rotation & revocation.
- **`EmailVerificationToken`**: Token for initial registration email confirmation.
- **`PasswordResetToken`**: Secure hashed password reset tokens with single-use consumption.
- **`InvitationToken`**: Allows Owners to invite staff/contractors to their organization.
- **`AuditLog`**: Immutable ledger of all security, authentication, and organizational events.

### Modules 2–5 Models (Upcoming NDIS Core):
- **`NdisSupportItem`**: Official Australian Government 2026 Price Limits and rate caps.
- **`Client`**: NDIS Participants (9-digit NDIS IDs, Plan Manager agency email routing, budget limits).
- **`Shift`**: Work logs with auto-split rates (Day, Evening, Saturday, Sunday, Holiday, Travel KMs, SOAP notes).
- **`Invoice` & `InvoiceLineItem`**: Compliant Australian NDIS Tax Invoices with direct Plan Manager dispatch.

---

## 4. Authentication & Security Flows

1. **Email / Password Flow**:
   - `POST /api/auth/register` (Creates Business in `TRIALING` + User as `OWNER` + sends verification email)
   - `POST /api/auth/login` (Returns Access Token + HttpOnly Refresh Token)
   - `POST /api/auth/refresh` (Rotates Refresh Token)
   - `POST /api/auth/logout` (Revokes session)
   - `POST /api/auth/forgot-password` & `POST /api/auth/reset-password`
   - `POST /api/auth/verify-email` & `POST /api/auth/resend-verification`
2. **Google OAuth 2.0 Flow**:
   - `POST /api/auth/google` (Verifies Google `id_token` / `access_token`, auto-provisions or logs in user)
   - Google Client ID: `1059143178866-opnovptf4l8tfe8cefeln6lvf29mdedv.apps.googleusercontent.com`
   - Frontend Trigger: `components/ui/GoogleButton.tsx`

---

## 5. Environment Variables Reference

### Frontend (`Rayvice-frontend/.env.local` & Vercel)
- `NEXT_PUBLIC_API_URL`: Backend API URL (e.g. `https://rayvice-backend.onrender.com/api` or `http://localhost:5000/api`)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: `1059143178866-opnovptf4l8tfe8cefeln6lvf29mdedv.apps.googleusercontent.com`

### Backend (`Rayvice-backend/.env` & Render)
- `DATABASE_URL`: Neon PostgreSQL connection string
- `JWT_ACCESS_SECRET`: Secret for signing access tokens
- `JWT_REFRESH_SECRET`: Secret for signing refresh tokens
- `PORT`: Default `5000` / dynamic port
- `CORS_ORIGIN`: Allowed origins (e.g. `https://www.rayvice.com,https://rayvice.com,http://localhost:3000`)
- `RESEND_API_KEY`: API key for invoice and verification emails
- `GROQ_API_KEY` / `GEMINI_API_KEY`: Speech-to-text & JSON parsing
- `STRIPE_SECRET_KEY` & `STRIPE_WEBHOOK_SECRET`: Australian subscription billing

---

## 6. NDIS Product Roadmap

1. **Module 1: Authentication & Multi-Tenant Foundation** ✅ (COMPLETE)
2. **Module 2: Business Profile & NDIS Billing Setup** (ABN, BSB/Bank Details, Invoice Prefix)
3. **Module 3: NDIS Participant & Plan Manager Directory** (9-digit NDIS validation, agency emails)
4. **Module 4: Shift Logging & Auto-Split Calculation Engine** (Voice intake, 8:00 PM evening split, weekend rate calculation)
5. **Module 5: Invoicing, Auto-Rejection Shield & Plan Manager Dispatch** (Pre-flight validator, `@react-pdf` engine, Resend delivery)

