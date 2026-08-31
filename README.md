# Rayvice Backend — NDIS Sole-Trader Billing & Compliance OS

**Backend Architecture & Express API Service**

Rayvice is an automated billing, rate-splitting, and compliance engine built specifically for Australian NDIS Sole Traders (Support Workers, Cleaners, Independent Carers, Allied Health Assistants).

---

## 1. Tech Stack (LOCKED)

| Concern | Choice |
|---|---|
| **Language** | TypeScript |
| **Runtime** | Node.js (LTS) |
| **Framework** | Express.js |
| **Database** | PostgreSQL (Neon Serverless) |
| **ORM** | Prisma ORM |
| **Auth** | JWT (access) + opaque refresh tokens (DB-backed, rotating) + Google OAuth 2.0 |
| **Validation** | Zod |
| **Password Hashing** | Argon2id |
| **Email Delivery** | Resend API / SMTP |
| **AI Speech & Parsing** | Groq Whisper + Gemini Flash (Voice-to-Shift JSON) |
| **Payments** | Stripe Billing ($24 AUD/mo, $44 AUD/mo) |

---

## 2. Modules Roadmap

### ✅ Module 1: Authentication & Tenant Foundation (COMPLETE)
- **Business** — the sole-trader tenant entity. Trial status, ABN, BSB/bank metadata.
- **User** — belongs to exactly one Business. Roles: `OWNER`, `OFFICE_MANAGER`, `TECHNICIAN`. Lockout fields for brute-force protection.
- **RefreshToken** — hashed, revocable, rotating.
- **EmailVerificationToken**, **PasswordResetToken**, **InvitationToken** — single-use, hashed, expiring.
- **AuditLog** — immutable, append-only security/business event log.

### 🔨 Upcoming NDIS Core Modules:
- **Module 2: Business Profile & NDIS Billing Config** (ABN validation, BSB & Bank details, invoice numbering).
- **Module 3: NDIS Participant & Plan Manager Directory** (9-digit NDIS validation, agency billing routing, budget tracking).
- **Module 4: Shift Logging & Auto-Split Engine** (Voice intake, 8:00 PM evening split, weekend rate calculation, travel KMs).
- **Module 5: Invoicing, Auto-Rejection Shield & Plan Manager Dispatch** (Pre-flight validation, PDF generation, Resend email dispatch).

---

## 3. Endpoints Overview

All responses follow the standard envelope:
```json
{ "success": true, "message": "...", "data": { } }
{ "success": false, "message": "...", "errorCode": "..." }
```

**`/api/v1/auth`**
| Method | Path | Description |
|---|---|---|
| POST | `/register` | Registers a Business + Owner user, starts 14-day trial, sends verification email |
| POST | `/login` | Email + password login with brute-force protection |
| POST | `/google` | 1-Tap Google OAuth 2.0 verification and account provisioning |
| POST | `/refresh` | Rotates refresh token (cookie-based), issues new access token |
| POST | `/logout` | Revokes current device's refresh token |
| POST | `/verify-email` | Consumes an email verification token |
| POST | `/resend-verification` | Re-sends verification email |
| POST | `/forgot-password` | Requests a password reset email |
| POST | `/reset-password` | Consumes reset token, sets new password |
| GET | `/me` 🔒 | Current user + business profile |
| POST | `/change-password` 🔒 | Authenticated password change |

**`/api/v1/business`**
| Method | Path | Description |
|---|---|---|
| GET | `/me` 🔒 | Current business profile & trial status |
| PATCH | `/me` 🔒 Owner | Updates business profile (ABN, phone, name) |
| POST | `/team/invite` 🔒 Owner | Invites staff/contractor |
| GET | `/team` 🔒 Owner | Paginated team list |

🔒 = requires `Authorization: Bearer <accessToken>`

---

## 4. Setup & Running Locally

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL (Neon Postgres), JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

npm install
npm run prisma:generate
npm run prisma:migrate      # applies the database schema
npm run dev                 # http://localhost:5000
```

Health check: `GET /health` or `GET /api/health`

