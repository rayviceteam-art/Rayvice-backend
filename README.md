# Rayvice Backend — Module 1

**Authentication + Organization + Tenant Foundation**

This is the complete, runnable implementation of **Module 1 only**, built strictly from the attached project documentation (BACKEND-01 → 04, GLOBAL-RULES, MASTER-02, MASTER-06, MASTER-09, MASTER-10). No functionality from later modules (Customers, Appointments, CRM, AI Receptionist, Billing, Reports, Notifications, etc.) is implemented or stubbed.

---

## 1. Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript |
| Runtime | Node.js (LTS) |
| Framework | Express.js |
| Database | PostgreSQL |
| ORM | Prisma |
| Auth | JWT (access) + opaque refresh tokens (DB-backed, rotating) |
| Validation | Zod |
| Password hashing | Argon2id |
| Package manager | npm |

## 2. What's included

### Data model (`prisma/schema.prisma`)
- **Business** — the tenant. Trial status/dates, soft delete, standard metadata.
- **User** — belongs to exactly one Business. Roles: `OWNER`, `OFFICE_MANAGER`, `TECHNICIAN`. Lockout fields for brute-force protection.
- **RefreshToken** — hashed, revocable, rotating.
- **EmailVerificationToken**, **PasswordResetToken**, **InvitationToken** — single-use, hashed, expiring.
- **AuditLog** — immutable, append-only security/business event log.

Only entities required for Module 1 exist. No Customer/Appointment/Billing/AI tables were created, per BACKEND-02 §16.

### Endpoints

All responses follow the standard envelope from BACKEND-04 §6:
```json
{ "success": true, "message": "...", "data": { } }
{ "success": false, "message": "...", "errorCode": "..." }
```

**`/api/v1/auth`** (public unless noted)
| Method | Path | Description |
|---|---|---|
| POST | `/register` | Registers a Business + Owner user, starts 3-day trial, sends verification email, returns tokens |
| POST | `/login` | Email + password login, brute-force lockout after 5 failed attempts |
| POST | `/refresh` | Rotates refresh token (cookie-based), issues new access token |
| POST | `/logout` | Revokes current device's refresh token |
| POST | `/verify-email` | Consumes an email verification token |
| POST | `/resend-verification` | Re-sends verification email (enumeration-safe) |
| POST | `/forgot-password` | Requests a password reset email (enumeration-safe) |
| POST | `/reset-password` | Consumes reset token, sets new password, revokes all sessions |
| GET | `/me` 🔒 | Current user + business profile |
| POST | `/change-password` 🔒 | Authenticated password change |

**`/api/v1/business`**
| Method | Path | Description |
|---|---|---|
| POST | `/team/accept-invite` | Invited user sets their password and activates their account |
| GET | `/me` 🔒 | Current business profile (incl. computed trial/read-only status) |
| PATCH | `/me` 🔒 Owner | Updates business profile |
| POST | `/team/invite` 🔒 Owner | Invites an Office Manager or Technician |
| GET | `/team` 🔒 Owner | Paginated team list (filter by role/status) |
| PATCH | `/team/:userId/suspend` 🔒 Owner | Suspends a team member |
| PATCH | `/team/:userId/reactivate` 🔒 Owner | Reactivates a suspended team member |

🔒 = requires `Authorization: Bearer <accessToken>`

### Cross-cutting concerns
- **RBAC** (`authorize()`) and **tenant isolation** (`businessId` scoping on every query) per BACKEND-03/GLOBAL-RULES §7.
- **Rate limiting**: general limiter + a stricter limiter on all auth endpoints (BACKEND-03 §14).
- **Centralized error handling** with consistent status codes (BACKEND-04 §12).
- **Audit logging** for every security-relevant event, immutable by design (no update/delete exposed).
- **Structured logging** (Winston) with automatic redaction of sensitive fields.
- **Trial policy** (GLOBAL-RULES §2-3): 3-day trial from registration; status is computed lazily (`TRIALING` → `READ_ONLY` once `trialEndsAt` passes) rather than via a cron job, so it is always correct.

## 3. Setup

```bash
cp .env.example .env
# edit .env — set DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET (32+ chars each)

npm install
npm run prisma:generate
npm run prisma:migrate      # creates the database schema
npm run dev                 # http://localhost:4000
```

Health check: `GET /health`

## 4. Documented assumptions

The source documents leave a few implementation details unspecified. Where that happened, the following defaults were chosen and are called out here rather than silently assumed:

1. **Password hashing algorithm**: BACKEND-01/03 reference bcrypt; this task's explicit tech-stack instruction specified Argon2id, which was followed as the more specific, most-recent instruction. Argon2id is a strict security upgrade over bcrypt.
2. **Password complexity policy** (min 8 chars, upper/lower/number): not specified in the documents; added as a conventional baseline consistent with "Hash passwords securely" / "Validate all input."
3. **Account lockout** (5 failed attempts → 15 minute lock): BACKEND-03 §14 requires brute-force protection but does not specify thresholds; these are reasonable, documented defaults in `auth.service.ts`.
4. **Refresh token transport**: an httpOnly, `SameSite=Lax` cookie scoped to `/api/v1/auth` was chosen over a response-body token, since this is the standard secure pattern for browser clients and the documents do not specify transport.
5. **Business contact email = Owner's registration email**: the registration form (per available fields) collects one email; it is used for both the Business record and the Owner's login. A separate business contact email was not specified as a requirement.
6. **Team invitation flow**: BACKEND-03 §3 grants "Team Management" to the Owner role but does not detail the invite mechanism; a standard invite-token-by-email flow was implemented since Module 1 explicitly covers "Organization ... Foundation" and multi-user tenants require some way to add Office Managers/Technicians.
7. **Email delivery**: BACKEND-01 §3/§9 specify an "Email Provider" and its API key as configuration, without naming a provider. SMTP (via `nodemailer`) was implemented as a provider-agnostic default; when `SMTP_HOST` is unset (e.g., local dev), messages are logged instead of silently dropped so flows remain testable end-to-end.

## 5. Explicitly out of scope (per instructions)

Nothing from Module 2 or later was implemented or stubbed, including: Customers, Appointments, Calendar, AI Receptionist, Call Logs, CRM, Revenue Dashboard, Reports, Notifications, Billing/Stripe integration, Subscription plan enforcement beyond the trial/read-only status field itself. The `Business.status` field and `deriveEffectiveBusinessStatus()` helper exist so a future Billing module can transition a business to `ACTIVE`, but no billing logic exists here.
