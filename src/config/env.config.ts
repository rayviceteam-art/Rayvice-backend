import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/**
 * Environment variable schema.
 *
 * Every value the application depends on must be declared and validated
 * here. Nothing outside this file should read from `process.env` directly.
 */
const envSchema = z.object({
  // --- Application ---
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_URL: z.string().url().default('http://localhost:4000'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  // --- Database ---
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((val) => val.startsWith('postgres'), {
      message: 'DATABASE_URL must be a valid PostgreSQL connection string',
    }),

  // --- Authentication ---
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // --- Rate Limiting ---
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // --- Logging ---
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and validates `process.env`.
 *
 * Throws immediately with a readable list of problems if any required
 * variable is missing or malformed, so the app never boots into a broken
 * state. This must be called once, on startup, before anything else.
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    // eslint-disable-next-line no-console
    console.error(
      `\n❌ Invalid environment configuration:\n${formattedErrors}\n\n` +
        'Fix the values in your .env file and restart the server.\n',
    );

    process.exit(1);
  }

  return result.data;
}

/**
 * Validated, strongly-typed environment configuration.
 * Import this everywhere instead of touching `process.env` directly.
 */
export const env: Env = parseEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
