import { CookieOptions, Response } from 'express';
import { isProduction } from '../config/env';

export const REFRESH_TOKEN_COOKIE = 'rayvice_refresh_token';

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction, // HTTPS-only in production, per MASTER-06 §10 "HTTPS everywhere"
    sameSite: 'none', // required: frontend (Vercel) and backend (Render) are different domains
    path: '/api/v1/auth',
  };
}

export function setRefreshTokenCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, { ...baseCookieOptions(), expires: expiresAt });
}

export function clearRefreshTokenCookie(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, baseCookieOptions());
}
