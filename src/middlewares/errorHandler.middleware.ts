import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.config';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

interface ErrorResponseBody {
  success: false;
  message: string;
  errors?: unknown;
  stack?: string;
}

/**
 * Single, centralized error handler for the entire application.
 *
 * Rules enforced here (per BACKEND-01 §8 and MASTER-09 §11):
 * - Never expose internal error details or stack traces in production.
 * - Always return a consistent JSON shape.
 * - Known/operational errors (AppError) map to their intended status code.
 * - Validation errors (Zod) are normalized into a 400 with field details.
 * - Anything unexpected is logged and returned as a generic 500.
 */
export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const body: ErrorResponseBody = {
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { path: req.path, method: req.method });
    }

    const body: ErrorResponseBody = {
      success: false,
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
    };
    res.status(err.statusCode).json(body);
    return;
  }

  const error = err instanceof Error ? err : new Error('Unknown error');

  logger.error(error.message, {
    path: req.path,
    method: req.method,
    stack: error.stack,
  });

  const body: ErrorResponseBody = {
    success: false,
    message: isProduction ? 'Internal server error' : error.message,
    ...(isProduction ? {} : { stack: error.stack }),
  };

  res.status(500).json(body);
}
