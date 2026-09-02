import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { env } from '../config/env';

/**
 * Checks if a user has platform super-admin privileges.
 */
export function isUserSuperAdmin(user?: { role?: string; email?: string } | null): boolean {
  if (!user) return false;
  if (user.role === 'SUPER_ADMIN') return true;
  const userEmail = user.email?.toLowerCase().trim();
  const superAdminList = [
    'rayviceofficial@gmail.com',
    'mdsartajalamcrypto@gmail.com',
    'mdsartajalam@gmail.com',
    'rayvice.team@gmail.com',
  ];
  if (superAdminList.includes(userEmail)) return true;
  if (!env.SUPER_ADMIN_EMAILS) return false;
  const adminEmails = env.SUPER_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase());
  return adminEmails.includes(userEmail);
}

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
    // Super Admins bypass tenant-level role restrictions
    if (isUserSuperAdmin(req.user) || allowedRoles.includes(req.user.role)) {
      next();
      return;
    }
    next(ApiError.forbidden('Your role does not have permission to perform this action.', 'ROLE_NOT_PERMITTED'));
  };
}

/**
 * Super-Admin Access Restriction.
 * Ensures the caller is either a designated Super Admin by role or email.
 */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(ApiError.unauthorized());
    return;
  }
  if (!isUserSuperAdmin(req.user)) {
    next(ApiError.forbidden('Super-Admin access required to perform this action.', 'SUPER_ADMIN_REQUIRED'));
    return;
  }
  next();
}
