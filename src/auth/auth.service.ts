import { UserRole } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { hashPassword, verifyPassword } from '../utils/password';
import { signAccessToken } from '../utils/jwt';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/token';
import { sendEmail } from '../utils/email.service';
import { recordAuditEvent } from '../audit/audit.service';
import { computeTrialEndDate } from '../business/trial.util';
import { logger } from '../config/logger';
import {
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResendVerificationInput,
  ResetPasswordInput,
  VerifyEmailInput,
  ChangePasswordInput,
  GoogleAuthInput,
} from './auth.validators';

// BACKEND-03 §14 — "Protect against brute-force attacks."
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const userPublicSelect = {
  id: true,
  businessId: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

async function issueTokenPair(userId: string, businessId: string, role: UserRole, meta: RequestMeta): Promise<IssuedTokens> {
  const accessToken = signAccessToken({ sub: userId, businessId, role });

  const { rawToken, tokenHash } = generateOpaqueToken();
  // JWT_REFRESH_EXPIRES_IN is a human-readable duration (e.g. "30d", "12h").
  // Computed as an exact millisecond offset — not via Date.setDate — because
  // setDate() truncates fractional day values, which would silently produce
  // a near-zero expiry for any sub-day duration.
  const refreshTokenExpiresAt = new Date(Date.now() + parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN));

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: refreshTokenExpiresAt,
      userAgent: meta.userAgent ?? undefined,
      ipAddress: meta.ipAddress ?? undefined,
    },
  });

  return { accessToken, refreshToken: rawToken, refreshTokenExpiresAt };
}

const MS_PER_UNIT: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) return 30 * MS_PER_UNIT.d; // Fallback: 30 days
  const value = Number(match[1]);
  return value * MS_PER_UNIT[match[2]];
}

/**
 * Registers a new Business (tenant) and its first user as OWNER.
 * GLOBAL-RULES §2 — starts the 3-day trial immediately, no card required.
 * BACKEND-02 §7 — "Prevent duplicate businesses" is enforced via the unique
 * constraint on Business.email and User.email at the database layer.
 */
export async function registerBusiness(input: RegisterInput, meta: RequestMeta) {
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists.', 'EMAIL_ALREADY_REGISTERED');
  }

  const existingBusiness = await prisma.business.findUnique({ where: { email: input.email } });
  if (existingBusiness) {
    throw ApiError.conflict('A business with this email already exists.', 'BUSINESS_ALREADY_REGISTERED');
  }

  const passwordHash = await hashPassword(input.password);
  const trialEndsAt = computeTrialEndDate();

  const { business, user } = await prisma.$transaction(async (tx) => {
    const createdBusiness = await tx.business.create({
      data: {
        name: input.businessName,
        email: input.email,
        phone: input.businessPhone,
        industry: input.industry,
        status: 'TRIALING',
        trialEndsAt,
        hasUsedTrial: true,
      },
    });

    const createdUser = await tx.user.create({
      data: {
        businessId: createdBusiness.id,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'OWNER',
        status: 'ACTIVE',
      },
      select: userPublicSelect,
    });

    return { business: createdBusiness, user: createdUser };
  });

  await recordAuditEvent({
    action: 'BUSINESS_REGISTERED',
    businessId: business.id,
    userId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  await sendEmailVerificationToken(user.id, user.email, user.firstName);

  const tokens = await issueTokenPair(user.id, business.id, user.role, meta);

  return { business, user, tokens };
}

async function sendEmailVerificationToken(userId: string, email: string, firstName: string): Promise<void> {
  const { rawToken, tokenHash } = generateOpaqueToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS);

  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  const verificationUrl = `${env.CLIENT_URL}/verify-email?token=${rawToken}`;

  await sendEmail({
    to: email,
    subject: 'Verify your Rayvice account',
    html: `<p>Hi ${firstName},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verificationUrl}">${verificationUrl}</a></p><p>This link expires in ${env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours.</p>`,
    text: `Hi ${firstName}, verify your email: ${verificationUrl} (expires in ${env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours)`,
  });

  await recordAuditEvent({ action: 'EMAIL_VERIFICATION_SENT', userId });
}

/**
 * Authenticates a user by email + password.
 * BACKEND-03 §2 — Secure Login; §14 — brute-force protection via lockout.
 */
export async function login(input: LoginInput, meta: RequestMeta) {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { business: { select: { id: true, status: true, trialEndsAt: true, deletedAt: true } } },
  });

  if (!user || user.deletedAt || user.business.deletedAt) {
    await recordAuditEvent({
      action: 'LOGIN_FAILED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { email: input.email, reason: 'account_not_found' },
    });
    throw ApiError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await recordAuditEvent({
      action: 'LOGIN_FAILED',
      businessId: user.businessId,
      userId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason: 'account_locked' },
    });
    throw ApiError.forbidden('Account temporarily locked due to too many failed login attempts. Try again later.', 'ACCOUNT_LOCKED');
  }

  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('Your account is not active. Contact your business owner.', 'ACCOUNT_INACTIVE');
  }

  const isPasswordValid = await verifyPassword(user.passwordHash, input.password);

  if (!isPasswordValid) {
    const failedAttempts = user.failedLoginAttempts + 1;
    const shouldLock = failedAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : failedAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000) : null,
      },
    });

    await recordAuditEvent({
      action: 'LOGIN_FAILED',
      businessId: user.businessId,
      userId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { reason: 'invalid_password', shouldLock },
    });

    throw ApiError.unauthorized('Invalid email or password.', 'INVALID_CREDENTIALS');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });

  await recordAuditEvent({
    action: 'LOGIN_SUCCESS',
    businessId: user.businessId,
    userId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  const tokens = await issueTokenPair(user.id, user.businessId, user.role, meta);

  const { passwordHash: _omit, lockedUntil: _omit2, failedLoginAttempts: _omit3, ...safeUser } = user;
  void _omit;
  void _omit2;
  void _omit3;

  return { user: safeUser, tokens };
}

/**
 * Rotates a refresh token: the presented token is revoked and a new
 * access/refresh pair is issued. Reusing an already-revoked token revokes
 * the entire chain, which signals possible token theft.
 * BACKEND-03 §5 — Session Management / Refresh Token Support.
 */
export async function refreshSession(rawRefreshToken: string, meta: RequestMeta) {
  const tokenHash = hashOpaqueToken(rawRefreshToken);

  const existingToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { business: { select: { id: true, deletedAt: true } } } } },
  });

  if (!existingToken) {
    throw ApiError.unauthorized('Invalid refresh token.', 'INVALID_REFRESH_TOKEN');
  }

  if (existingToken.revokedAt) {
    // Token reuse detected — revoke all active sessions for this user as a precaution.
    await prisma.refreshToken.updateMany({
      where: { userId: existingToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn('Refresh token reuse detected — all sessions revoked', { userId: existingToken.userId });
    throw ApiError.unauthorized('Refresh token has already been used. All sessions have been revoked for your security.', 'REFRESH_TOKEN_REUSED');
  }

  if (existingToken.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token has expired. Please log in again.', 'REFRESH_TOKEN_EXPIRED');
  }

  const user = existingToken.user;
  if (!user || user.deletedAt || user.business.deletedAt || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Account is no longer active.', 'ACCOUNT_INACTIVE');
  }

  const tokens = await issueTokenPair(user.id, user.businessId, user.role, meta);
  const newTokenHash = hashOpaqueToken(tokens.refreshToken);

  await prisma.refreshToken.update({
    where: { id: existingToken.id },
    data: { revokedAt: new Date(), replacedByTokenHash: newTokenHash },
  });

  await recordAuditEvent({
    action: 'TOKEN_REFRESHED',
    businessId: user.businessId,
    userId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { tokens, businessId: user.businessId, role: user.role };
}

/**
 * Revokes a single refresh token (logout from current device).
 * BACKEND-03 §5 — "Allow logout from current device."
 */
export async function logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
  if (!rawRefreshToken) return;

  const tokenHash = hashOpaqueToken(rawRefreshToken);
  const existingToken = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existingToken || existingToken.revokedAt) return;

  await prisma.refreshToken.update({
    where: { id: existingToken.id },
    data: { revokedAt: new Date() },
  });

  await recordAuditEvent({
    action: 'LOGOUT',
    userId: existingToken.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function verifyEmail(input: VerifyEmailInput): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('This verification link is invalid or has expired.', 'INVALID_VERIFICATION_TOKEN');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    prisma.emailVerificationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
  ]);

  await recordAuditEvent({ action: 'EMAIL_VERIFIED', userId: record.userId });
}

export async function resendVerificationEmail(input: ResendVerificationInput): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Always behave the same whether or not the account exists / is already
  // verified, to avoid leaking account existence (GLOBAL-RULES §9 security).
  if (!user || user.emailVerifiedAt || user.deletedAt) return;

  await sendEmailVerificationToken(user.id, user.email, user.firstName);
}

/**
 * Always returns success regardless of whether the email exists, to prevent
 * user enumeration (GLOBAL-RULES §9 — "Validate all input" / general
 * security-first principle applied at the API boundary).
 */
export async function forgotPassword(input: ForgotPasswordInput, meta: RequestMeta): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || user.deletedAt) return;

  const { rawToken, tokenHash } = generateOpaqueToken();
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES);

  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt } });

  const resetUrl = `${env.CLIENT_URL}/reset-password?token=${rawToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Reset your Rayvice password',
    html: `<p>Hi ${user.firstName},</p><p>We received a request to reset your password. This link expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, you can safely ignore this email.</p>`,
    text: `Reset your password: ${resetUrl} (expires in ${env.PASSWORD_RESET_TOKEN_TTL_MINUTES} minutes)`,
  });

  await recordAuditEvent({
    action: 'PASSWORD_RESET_REQUESTED',
    businessId: user.businessId,
    userId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
  const tokenHash = hashOpaqueToken(input.token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('This password reset link is invalid or has expired.', 'INVALID_RESET_TOKEN');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    // Force re-authentication everywhere — a password reset invalidates all existing sessions.
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { businessId: true } });

  await recordAuditEvent({
    action: 'PASSWORD_RESET_COMPLETED',
    businessId: user?.businessId,
    userId: record.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Authenticated password change (user knows their current password).
 */
export async function changePassword(userId: string, input: ChangePasswordInput, meta: RequestMeta): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  const isCurrentValid = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!isCurrentValid) {
    throw ApiError.badRequest('Current password is incorrect.', 'INVALID_CURRENT_PASSWORD');
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await recordAuditEvent({
    action: 'PASSWORD_CHANGED',
    businessId: user.businessId,
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function getCurrentUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...userPublicSelect,
      business: {
        select: { id: true, name: true, email: true, phone: true, industry: true, status: true, trialEndsAt: true, createdAt: true },
      },
    },
  });

  if (!user) {
    throw ApiError.notFound('User not found.');
  }

  return user;
}

export interface GoogleUserInfo {
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  sub?: string;
}

async function verifyGoogleToken(input: GoogleAuthInput): Promise<GoogleUserInfo> {
  const token = input.credential || input.idToken || input.accessToken;
  if (!token) {
    throw ApiError.badRequest('Google credential, idToken, or accessToken is required.', 'MISSING_GOOGLE_TOKEN');
  }

  try {
    const url = input.credential || input.idToken
      ? `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`
      : `https://www.googleapis.com/oauth2/v3/userinfo`;

    const headers: Record<string, string> = {};
    if (input.accessToken) {
      headers['Authorization'] = `Bearer ${input.accessToken}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Google verification responded with status ${response.status}`);
    }

    const data = (await response.json()) as GoogleUserInfo;
    if (!data.email) {
      throw new Error('Google token did not contain an email address.');
    }

    return {
      email: data.email.toLowerCase().trim(),
      email_verified: data.email_verified === true || (data as Record<string, unknown>).email_verified === 'true',
      given_name: data.given_name || data.name?.split(' ')[0] || 'User',
      family_name: data.family_name || data.name?.split(' ').slice(1).join(' ') || '',
      picture: data.picture,
      sub: data.sub,
    };
  } catch (error) {
    logger.error('Google token verification failed', { error });
    throw ApiError.unauthorized('Failed to authenticate with Google. Invalid or expired token.', 'GOOGLE_AUTH_FAILED');
  }
}

export async function googleAuth(input: GoogleAuthInput, meta: RequestMeta) {
  const googleUser = await verifyGoogleToken(input);

  const existingUser = await prisma.user.findUnique({
    where: { email: googleUser.email },
    include: { business: true },
  });

  let user: any;
  let business: any;

  if (existingUser) {
    if (existingUser.deletedAt || existingUser.business.deletedAt) {
      throw ApiError.unauthorized('Account has been deactivated.', 'ACCOUNT_DEACTIVATED');
    }

    if (existingUser.status !== 'ACTIVE') {
      throw ApiError.forbidden('Your account is not active. Contact your business owner.', 'ACCOUNT_INACTIVE');
    }

    user = await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
        emailVerifiedAt: existingUser.emailVerifiedAt ?? (googleUser.email_verified ? new Date() : null),
      },
      include: { business: true },
    });

    business = user.business;

    await recordAuditEvent({
      action: 'LOGIN_SUCCESS',
      businessId: business.id,
      userId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { authProvider: 'google' },
    });
  } else {
    // New registration via Google Sign-In
    const trialEndsAt = computeTrialEndDate();
    const { rawToken } = generateOpaqueToken();
    const passwordHash = await hashPassword(rawToken);

    const result = await prisma.$transaction(async (tx) => {
      const createdBusiness = await tx.business.create({
        data: {
          name: `${googleUser.given_name}'s Business`,
          email: googleUser.email,
          status: 'TRIALING',
          trialEndsAt,
          hasUsedTrial: true,
        },
      });

      const createdUser = await tx.user.create({
        data: {
          businessId: createdBusiness.id,
          email: googleUser.email,
          passwordHash,
          firstName: googleUser.given_name || 'User',
          lastName: googleUser.family_name || '',
          role: 'OWNER',
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        },
      });

      return { business: createdBusiness, user: createdUser };
    });

    business = result.business;
    user = result.user;

    await recordAuditEvent({
      action: 'BUSINESS_REGISTERED',
      businessId: business.id,
      userId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { authProvider: 'google' },
    });

    await recordAuditEvent({
      action: 'LOGIN_SUCCESS',
      businessId: business.id,
      userId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { authProvider: 'google' },
    });
  }

  const tokens = await issueTokenPair(user.id, business.id, user.role, meta);

  const sanitizedUser = {
    id: user.id,
    businessId: user.businessId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };

  return { business, user: sanitizedUser, tokens };
}
