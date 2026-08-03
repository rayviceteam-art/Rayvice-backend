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
    statusCode = 422;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed.';
    details = err.flatten().fieldErrors;
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

  res.status(statusCode).json({
    success: false,
    message: isUnexpected && isProduction ? 'An unexpected error occurred.' : message,
    errorCode,
    ...(details && !isProduction ? { details } : {}),
  });
}
