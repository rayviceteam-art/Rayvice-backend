import { Response } from 'express';

/**
 * BACKEND-04 §6 — every successful response must follow:
 * { success: true, message: string, data: object }
 */
export function sendSuccess<T>(res: Response, statusCode: number, message: string, data: T): Response {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
}
