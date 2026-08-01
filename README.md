# Rayvice Backend

AI-powered business management platform — backend API.

**Status:** Step 1 — Project Setup (complete)

---

## Tech Stack

- Node.js (>=20 LTS)
- Express.js
- TypeScript (strict mode)
- Zod (env & request validation)
- dotenv

---

## Folder Structure

```
src/
├── config/         # Environment config, future service configs (db, redis, etc.)
├── controllers/     # Thin request/response handlers — no business logic
├── middlewares/      # Express middlewares (error handling, auth, rate limiting...)
├── modules/           # Feature/domain modules (auth, crm, appointments, billing...)
├── routes/           # Route definitions, mounted onto the Express app
├── services/          # Business logic — the only layer that talks to the database
├── utils/            # Shared, reusable helpers (AppError, logger, asyncHandler)
├── app.ts             # Express app factory (middleware + route wiring)
└── server.ts           # Process entry point — binds app to a port
```

Domain modules (auth, crm, appointments, revenue, billing, notifications, reports, ai)
will be added under `src/modules/<name>/` in later steps, each owning its own
routes, controllers, services, and validators — keeping business logic
isolated and non-duplicated per BACKEND-01 §6.

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Copy environment template and fill in real values
cp .env.example .env

# 3. Run in development (auto-reload)
npm run dev

# 4. Type-check
npm run typecheck

# 5. Lint
npm run lint

# 6. Build for production
npm run build
npm start
```

---

## Environment Variables

All environment variables are declared and validated in
`src/config/env.config.ts` using Zod. The application refuses to boot if
any required variable is missing or malformed — see `.env.example` for the
full list.

---

## Request Lifecycle

Every request follows the pipeline defined in BACKEND-01 §7:

```
Request → Auth Middleware → Authorization → Validation → Controller
        → Service (business logic) → Database → Response Formatter → Client
```

Errors at any stage are forwarded (via `next(err)`) to the centralized
error handler in `src/middlewares/errorHandler.middleware.ts`, which is
the single place responsible for shaping error responses and deciding what
is safe to expose to clients.

---

## Health Check

`GET /api/v1/health` — returns service status, environment, and uptime.
Used by deployment platforms and uptime monitors.
