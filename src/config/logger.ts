import winston from 'winston';
import { env, isProduction } from './env';

/**
 * Centralized structured logger.
 *
 * BACKEND-01 §10 — logs authentication events, API errors, and critical
 * system events, but "Sensitive information must never be logged."
 * Callers are responsible for never passing passwords, tokens, or secrets
 * into log metadata — see redact() below as a defensive backstop.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'secret',
]);

function redact(meta: unknown): unknown {
  if (meta === null || typeof meta !== 'object') return meta;
  if (Array.isArray(meta)) return meta.map(redact);

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      clone[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      clone[key] = redact(value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}

const redactFormat = winston.format((info) => {
  const { level, message, timestamp, ...meta } = info;
  return { level, message, timestamp, ...(redact(meta) as object) };
});

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    redactFormat(),
    isProduction ? winston.format.json() : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  ),
  defaultMeta: { service: 'rayvice-backend', env: env.NODE_ENV },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
  exitOnError: false,
});
