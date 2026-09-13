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

  static paymentRequired(message = 'Subscription required to perform this action.', errorCode = 'PAYMENT_REQUIRED', details?: unknown): ApiError {
    return new ApiError(402, errorCode, message, details);
  }

  static forbidden(message = 'You do not have permission to perform this action.', errorCode = 'FORBIDDEN'): ApiError {
    return new ApiError(403, errorCode, message);
  }

  static notFound(message = 'Resource not found.', errorCode = 'NOT_FOUND'): ApiError {
    return new ApiError(404, errorCode, message);
  }

  static conflict(message: string, errorCode = 'CONFLICT', details?: unknown): ApiError {
    return new ApiError(409, errorCode, message, details);
  }

  static validation(message = 'Validation failed.', details?: unknown): ApiError {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }

  /** 422 — semantically invalid input (domain rule failure, not schema failure). */
  static unprocessable(message: string, errorCode = 'UNPROCESSABLE_ENTITY'): ApiError {
    return new ApiError(422, errorCode, message);
  }

  /** 413 — uploaded payload too large. */
  static tooLarge(message: string, errorCode = 'PAYLOAD_TOO_LARGE'): ApiError {
    return new ApiError(413, errorCode, message);
  }

  /** 415 — unsupported upload media type. */
  static unsupportedMediaType(message: string, errorCode = 'UNSUPPORTED_MEDIA_TYPE'): ApiError {
    return new ApiError(415, errorCode, message);
  }

  /** 503 — upstream feature temporarily unavailable. */
  static serviceUnavailable(message: string, errorCode = 'SERVICE_UNAVAILABLE'): ApiError {
    return new ApiError(503, errorCode, message);
  }

  /** 504 — upstream provider timed out. */
  static gatewayTimeout(message: string, errorCode = 'GATEWAY_TIMEOUT'): ApiError {
    return new ApiError(504, errorCode, message);
  }

  static tooManyRequests(message = 'Too many requests. Please try again later.'): ApiError {
    return new ApiError(429, 'RATE_LIMITED', message);
  }

  static internal(message = 'An unexpected error occurred.', errorCode = 'INTERNAL_SERVER_ERROR'): ApiError {
    return new ApiError(500, errorCode, message);
  }
}
