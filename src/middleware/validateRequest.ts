import { NextFunction, Request, Response } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

/**
 * Validates req.body / req.params / req.query against a Zod schema before
 * the request reaches any controller or service.
 * BACKEND-03 §11 — "Invalid requests must never reach the business logic layer."
 * BACKEND-04 §8 — "Never trust client-side validation alone."
 */
export function validateRequest(schema: AnyZodObject) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const parsed = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });
      req.body = parsed.body ?? req.body;
      req.params = (parsed.params as typeof req.params) ?? req.params;
      req.query = (parsed.query as typeof req.query) ?? req.query;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(ApiError.validation('Validation failed.', error.flatten().fieldErrors));
        return;
      }
      next(error);
    }
  };
}
