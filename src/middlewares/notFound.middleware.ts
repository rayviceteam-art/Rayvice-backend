import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../utils/AppError';

/**
 * Catches any request that didn't match a defined route and forwards
 * a consistent 404 into the centralized error handler.
 */
export function notFoundMiddleware(req: Request, _res: Response, next: NextFunction): void {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}
