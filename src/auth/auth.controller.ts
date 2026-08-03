import { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { REFRESH_TOKEN_COOKIE, clearRefreshTokenCookie, setRefreshTokenCookie } from '../utils/cookies';
import * as authService from './auth.service';
import { RequestMeta } from './auth.service';

function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { business, user, tokens } = await authService.registerBusiness(req.body, requestMeta(req));
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  sendSuccess(res, 201, 'Business registered successfully. A verification email has been sent.', {
    business,
    user,
    accessToken: tokens.accessToken,
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, tokens } = await authService.login(req.body, requestMeta(req));
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  sendSuccess(res, 200, 'Login successful.', { user, accessToken: tokens.accessToken });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
  if (!rawRefreshToken) {
    throw ApiError.unauthorized('No refresh token provided.', 'MISSING_REFRESH_TOKEN');
  }
  const { tokens } = await authService.refreshSession(rawRefreshToken, requestMeta(req));
  setRefreshTokenCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  sendSuccess(res, 200, 'Token refreshed successfully.', { accessToken: tokens.accessToken });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
  await authService.logout(rawRefreshToken, requestMeta(req));
  clearRefreshTokenCookie(res);
  sendSuccess(res, 200, 'Logged out successfully.', {});
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  await authService.verifyEmail(req.body);
  sendSuccess(res, 200, 'Email verified successfully.', {});
});

export const resendVerification = asyncHandler(async (req: Request, res: Response) => {
  await authService.resendVerificationEmail(req.body);
  sendSuccess(res, 200, 'If an account with that email exists and is unverified, a verification email has been sent.', {});
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.forgotPassword(req.body, requestMeta(req));
  sendSuccess(res, 200, 'If an account with that email exists, a password reset link has been sent.', {});
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.resetPassword(req.body, requestMeta(req));
  sendSuccess(res, 200, 'Password has been reset successfully. Please log in with your new password.', {});
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.changePassword(req.user!.id, req.body, requestMeta(req));
  sendSuccess(res, 200, 'Password changed successfully.', {});
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const profile = await authService.getCurrentUserProfile(req.user!.id);
  sendSuccess(res, 200, 'Current user profile retrieved.', profile);
});
