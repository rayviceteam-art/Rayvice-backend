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
  skipSuccessfulRequests: false,
  handler: (_req, _res, next) => next(ApiError.tooManyRequests('Too many attempts. Please try again later.')),
});
