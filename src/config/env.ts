import 'dotenv/config';
import { z } from 'zod';

/**
 * All configuration values are read from environment variables only.
 * BACKEND-01 §9 — "Never hardcode secrets."
 *
 * The schema fails fast on boot if required variables are missing or malformed,
 * rather than allowing the application to start in an insecure or broken state.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url(),
  CLIENT_URL: z.string().url(),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  CORS_ORIGIN: z.string().min(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  TRIAL_DURATION_HOURS: z.coerce.number().int().positive().default(216),

  // --- Module 4: voice AI (Section 16). Optional: the server boots without
  // them and only POST /shifts/voice-parse returns 503 VOICE_UNAVAILABLE. ---
  GROQ_API_KEY: z.string().optional().default(''),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().optional().default('gemini-2.5-flash'),
  VOICE_MAX_FILE_MB: z.coerce.number().int().positive().default(5),
  VOICE_MAX_SECONDS: z.coerce.number().int().positive().default(60),
  VOICE_DAILY_LIMIT_PER_USER: z.coerce.number().int().positive().default(30),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASSWORD: z.string().optional().default(''),
  EMAIL_FROM: z.string().default('Rayvice <no-reply@rayvice.com>'),

  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(24),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  INVITE_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(72),

  SUPER_ADMIN_EMAILS: z.string().optional().default('rayviceofficial@gmail.com'),

  // --- Module 5: Stripe billing (2.15). Optional: the server boots without
  // them and only /billing/* returns 503 BILLING_UNAVAILABLE. ---
  STRIPE_SECRET_KEY: z.string().optional().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(''),
  STRIPE_PRICE_BASIC_AUD: z.string().optional().default(''),
  STRIPE_PRICE_PRO_AUD: z.string().optional().default(''),
  INVOICE_DUE_DAYS: z.coerce.number().int().positive().default(14),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Intentionally synchronous & fatal — an invalid config must never reach production traffic.
  // eslint-disable-next-line no-console
  console.error('[CONFIG ERROR] Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** True when Stripe keys are configured; billing routes degrade gracefully otherwise (2.0 rule 12). */
export const isBillingConfigured = (): boolean =>
  Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);

