/**
 * Operational error type for known, expected failure cases
 * (validation failures, not-found resources, auth failures, etc).
 *
 * Distinguishing operational errors from programmer errors lets the
 * centralized error middleware decide what is safe to expose to clients.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;

    Object.setPrototypeOf(this, AppError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(message, 400, details);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(message, 403);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError(message, 404);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(message, 409, details);
  }

  static tooManyRequests(message = 'Too many requests'): AppError {
    return new AppError(message, 429);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(message, 500);
  }
}
