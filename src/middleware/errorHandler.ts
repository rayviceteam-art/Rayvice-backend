import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import { logger } from '../config/logger';
import { isProduction } from '../config/env';

/**
 * Single centralized error-handling middleware.
 * BACKEND-01 §7 — "Errors must be handled using centralized error middleware."
 * BACKEND-04 §12 — standardized HTTP status codes and response shape;
 * "Do not expose internal server details."
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred.';
  let details: unknown;

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    errorCode = err.errorCode;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    // Build field errors from issue paths directly (see validateRequest.ts).
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      if (issue.path.length === 0) continue;
      const key = String(issue.path[issue.path.length - 1]);
      if (!key) continue;
      (fieldErrors[key] ??= []).push(issue.message);
    }
    const messages: string[] = [];
    for (const [key, val] of Object.entries(fieldErrors)) {
      const readableKey = key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .trim();
      messages.push(`${readableKey}: ${val.join(', ')}`);
    }
    const friendlyMsg = messages.length > 0 ? messages.join(' • ') : 'Validation failed. Please verify your inputs.';
    statusCode = 422;
    errorCode = 'VALIDATION_ERROR';
    message = friendlyMsg;
    details = fieldErrors;
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      statusCode = 409;
      errorCode = 'DUPLICATE_RECORD';
      message = 'A record with these details already exists.';
    } else if (err.code === 'P2025') {
      statusCode = 404;
      errorCode = 'NOT_FOUND';
      message = 'The requested resource was not found.';
    }
  }

  const isUnexpected = statusCode >= 500;
  logger.log(isUnexpected ? 'error' : 'warn', message, {
    errorCode,
    statusCode,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip,
    stack: err instanceof Error ? err.stack : undefined,
  });

  // TEMPORARY DIAGNOSTIC (enabled only when EXPOSE_ERRORS=true) — surfaces the
  // underlying error for live debugging. Remove after the incident.
  const debugPayload =
    process.env.EXPOSE_ERRORS === 'true'
      ? {
          debug: {
            name: err instanceof Error ? err.name : typeof err,
            detail: err instanceof Error ? err.message : String(err),
            code: (err as { code?: string } | null)?.code,
            meta: (err as { meta?: unknown } | null)?.meta,
          },
        }
      : {};

  res.status(statusCode).json({
    success: false,
    message: isUnexpected && isProduction ? 'An unexpected error occurred.' : message,
    ...debugPayload,
    errorCode,
    ...(details ? { errors: details, details } : {}),
  });
}
