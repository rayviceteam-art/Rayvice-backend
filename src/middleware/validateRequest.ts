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
        // Build field errors from issue paths directly: zod 3.23's flatten()
        // collapses nested keys to the first segment ("body"), which the
        // frontend cannot map to form fields. Use the last path segment
        // (e.g. body.ndisNumber -> ndisNumber, params.id -> id).
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of error.issues) {
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
        const friendlyMsg =
          messages.length > 0 ? messages.join(' • ') : 'Validation failed. Please verify your inputs.';
        next(ApiError.validation(friendlyMsg, fieldErrors));
        return;
      }
      next(error);
    }
  };
}
