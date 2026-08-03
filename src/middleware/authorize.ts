import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ApiError } from '../utils/ApiError';

/**
 * Role-Based Access Control.
 * BACKEND-03 §4 — "Access must always be denied by default unless
 * permission is explicitly granted." Must run after `authenticate`.
 */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }
    if (!allowedRoles.includes(req.user.role)) {
      next(ApiError.forbidden('Your role does not have permission to perform this action.', 'ROLE_NOT_PERMITTED'));
      return;
    }
    next();
  };
}
