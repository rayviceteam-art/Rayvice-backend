import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '@prisma/client';

export interface AccessTokenPayload extends JwtPayload {
  sub: string; // userId
  businessId: string;
  role: UserRole;
  tokenType: 'access';
}

/**
 * Signs a short-lived JWT access token. Refresh tokens are NOT JWTs — they
 * are opaque random values stored (hashed) in the database, which allows
 * server-side revocation (BACKEND-03 §5 Session Management).
 */
export function signAccessToken(payload: Omit<AccessTokenPayload, 'tokenType'>): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign({ ...payload, tokenType: 'access' }, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  if (decoded.tokenType !== 'access') {
    throw new Error('Invalid token type');
  }
  return decoded;
}
