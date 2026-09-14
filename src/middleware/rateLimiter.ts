import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * General-purpose API rate limiter.
 * MASTER-02 §12.10, BACKEND-04 §13 — "Apply rate limiting."
 */
export const generalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests()),
});

/**
 * Stricter limiter applied to authentication endpoints to protect against
 * brute-force and credential-stuffing attacks.
 * BACKEND-03 §14 — "Protect against brute-force attacks. Rate-limit
 * authentication endpoints."
 */
export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Too many attempts. Please try again later.')),
});

/**
 * Login-specific rate limiter keyed by email+IP (composite).
 * Using IP alone causes one IP's quota to block brute-force DB counter
 * increments for different accounts, preventing account lockout from
 * triggering. Email+IP ensures each account's lockout counter is
 * independent, while still preventing credential-stuffing per IP+account.
 * BACKEND-03 §14 — "Protect against brute-force attacks."
 */
export const loginRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Composite key: IP + normalised email (falls back to IP-only if no body)
  keyGenerator: (req) => {
    const ip = req.ip ?? 'unknown';
    const email = (req.body?.email ?? '').toString().toLowerCase().trim();
    return email ? `${ip}:${email}` : ip;
  },
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Too many login attempts for this account. Please try again later.')),
});

/**
 * MODULE 4 — voice AI limits (BACKEND SPEC §11.3 / §12.7).
 * 10 requests / minute / user and 30 requests / day / user, in addition to
 * the global limiter. Keyed by authenticated user id (IP fallback for safety).
 */
function voiceKeyGenerator(req: any): string {
  const userId = req.user?.id;
  if (typeof userId === 'string' && userId.length > 0) return `voice:${userId}`;
  return `voice:${req.ip ?? 'unknown'}`;
}

export const voiceMinuteRateLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: voiceKeyGenerator,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Too many voice attempts. Please wait a moment.')),
});

export const voiceDailyRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: voiceKeyGenerator,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Daily voice limit reached. Please try again tomorrow.')),
});
