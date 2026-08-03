/**
 * Standard application error.
 *
 * BACKEND-04 §6/§12 — every error response must return a consistent shape
 * with a `success: false`, human-readable `message`, and a stable machine
 * `errorCode`, mapped to the correct HTTP status code.
 */
export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, errorCode = 'BAD_REQUEST', details?: unknown): ApiError {
    return new ApiError(400, errorCode, message, details);
  }

  static unauthorized(message = 'Authentication required.', errorCode = 'UNAUTHORIZED'): ApiError {
    return new ApiError(401, errorCode, message);
  }

  static forbidden(message = 'You do not have permission to perform this action.', errorCode = 'FORBIDDEN'): ApiError {
    return new ApiError(403, errorCode, message);
  }

  static notFound(message = 'Resource not found.', errorCode = 'NOT_FOUND'): ApiError {
    return new ApiError(404, errorCode, message);
  }

  static conflict(message: string, errorCode = 'CONFLICT'): ApiError {
    return new ApiError(409, errorCode, message);
  }

  static validation(message = 'Validation failed.', details?: unknown): ApiError {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }

  static tooManyRequests(message = 'Too many requests. Please try again later.'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'An unexpected error occurred.'): ApiError {
    return new ApiError(500, 'INTERNAL_SERVER_ERROR', message);
  }
}
