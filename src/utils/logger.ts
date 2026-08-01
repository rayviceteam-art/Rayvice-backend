import { env, isProduction } from '../config/env.config';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const levelPriority: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentPriority = levelPriority[
  (env.LOG_LEVEL as LogLevel) in levelPriority ? (env.LOG_LEVEL as LogLevel) : 'info'
];

/**
 * Structured logging utility.
 *
 * This is intentionally minimal for Step 1 (project setup). It follows the
 * documented logging rules — never logging secrets or sensitive customer
 * data — and exposes a stable interface so it can be swapped for
 * Winston/Pino in a later step without touching call sites.
 */
function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (levelPriority[level] > currentPriority) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  const output = isProduction ? JSON.stringify(entry) : formatForDevelopment(entry);

  // eslint-disable-next-line no-console
  const consoleMethod = level === 'debug' ? 'log' : level;
  // eslint-disable-next-line no-console
  (console[consoleMethod as 'log' | 'info' | 'warn' | 'error'])(output);
}

function formatForDevelopment(entry: {
  timestamp: string;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}): string {
  const metaStr = entry.meta ? ` ${JSON.stringify(entry.meta)}` : '';
  return `[${entry.timestamp}] ${entry.level.toUpperCase()}: ${entry.message}${metaStr}`;
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
};
