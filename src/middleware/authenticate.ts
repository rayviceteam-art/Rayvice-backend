import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { verifyAccessToken } from '../utils/jwt';
import { ApiError } from '../utils/ApiError';
import { asyncHandler } from '../utils/asyncHandler';
import { prisma } from '../config/database';

export interface AuthenticatedUser {
  id: string;
  businessId: string;
  role: UserRole;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/**
 * Verifies the JWT access token and re-confirms, on every request, that the
 * account and its business are still valid.
 *
 * BACKEND-04 §7 — protected APIs require: valid JWT, active account, correct
 * permissions, and business ownership verification. The role/business checks
 * happen here and in `authorize()` / tenant scoping in each service.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req);
  if (!token) {
    throw ApiError.unauthorized('Missing or malformed Authorization header.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token.', 'INVALID_TOKEN');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      businessId: true,
      role: true,
      status: true,
      deletedAt: true,
      business: { select: { status: true, deletedAt: true } },
    },
  });

  if (!user || user.deletedAt || user.business.deletedAt) {
    throw ApiError.unauthorized('Account no longer exists.', 'ACCOUNT_NOT_FOUND');
  }

  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('Your account is not active. Contact your business owner.', 'ACCOUNT_INACTIVE');
  }

  if (user.business.status === 'SUSPENDED') {
    throw ApiError.forbidden('This business account has been suspended.', 'BUSINESS_SUSPENDED');
  }

  req.user = {
    id: user.id,
    businessId: user.businessId,
    role: user.role,
    email: user.email,
  };

  next();
});
