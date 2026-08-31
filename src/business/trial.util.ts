import { env } from '../config/env';
import { BusinessStatus } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { prisma } from '../config/database';

/**
 * 9-Day Free Trial Policy & Resource Quotas
 * During the 9-day trial (216 hours), a sole trader gets limited access:
 * - Exactly 1 active participant (client) to test the platform.
 * - Up to 5 shift logs.
 * - Up to 2 NDIS compliant tax invoices.
 * - 3 Voice AI transcriptions.
 */
export const TRIAL_LIMITS = {
  MAX_CLIENTS: 1,
  MAX_SHIFTS: 5,
  MAX_INVOICES: 2,
  MAX_VOICE_TRANSCRIPTIONS: 3,
  DURATION_HOURS: 216, // 9 days
} as const;

/**
 * GLOBAL-RULES §2 — "Every newly registered business automatically receives
 * a 9-Day Free Trial... The trial expires automatically after 216 hours (9 days)."
 */
export function computeTrialEndDate(from: Date = new Date()): Date {
  const trialEnd = new Date(from);
  trialEnd.setHours(trialEnd.getHours() + (env.TRIAL_DURATION_HOURS || TRIAL_LIMITS.DURATION_HOURS));
  return trialEnd;
}

/**
 * GLOBAL-RULES §3 — when the trial expires without a paid subscription, the
 * business becomes Read-Only (login remains available; data is preserved;
 * new appointments / shifts / invoices are blocked in the modules that own them).
 *
 * This is a pure status derivation, evaluated lazily rather than via a
 * background job, so it is always correct regardless of when it is read.
 */
export function deriveEffectiveBusinessStatus(business: {
  status: BusinessStatus;
  trialEndsAt: Date;
}): BusinessStatus {
  if (business.status === 'TRIALING' && business.trialEndsAt.getTime() <= Date.now()) {
    return 'READ_ONLY';
  }
  return business.status;
}

/**
 * Computes human-readable trial information and days remaining.
 */
export function getTrialDetails(business: { status: BusinessStatus; trialEndsAt: Date }) {
  const effectiveStatus = deriveEffectiveBusinessStatus(business);
  const now = Date.now();
  const msRemaining = Math.max(0, business.trialEndsAt.getTime() - now);
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  const isExpired = business.status === 'TRIALING' && msRemaining === 0;

  return {
    status: business.status,
    effectiveStatus,
    trialEndsAt: business.trialEndsAt,
    daysRemaining: effectiveStatus === 'TRIALING' ? daysRemaining : 0,
    isExpired,
    limits: TRIAL_LIMITS,
  };
}

/**
 * Asserts that a business is allowed to perform write/mutation operations.
 * Throws 402 if trial is expired (READ_ONLY) or 403 if SUSPENDED.
 */
export async function assertCanMutate(businessId: string): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { status: true, trialEndsAt: true },
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const effectiveStatus = deriveEffectiveBusinessStatus(business);

  if (effectiveStatus === 'SUSPENDED') {
    throw ApiError.forbidden('Your business account has been suspended.', 'BUSINESS_SUSPENDED');
  }

  if (effectiveStatus === 'READ_ONLY') {
    throw ApiError.paymentRequired(
      'Your 9-day free trial has expired. Upgrade to a paid plan to resume creating records.',
      'TRIAL_EXPIRED'
    );
  }
}

/**
 * Guard that enforces trial limits on clients, shifts, or invoices when in TRIALING status.
 */
export async function checkTrialResourceLimit(
  businessId: string,
  resourceType: 'clients' | 'shifts' | 'invoices'
): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { status: true, trialEndsAt: true },
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const effectiveStatus = deriveEffectiveBusinessStatus(business);

  if (effectiveStatus === 'READ_ONLY') {
    throw ApiError.paymentRequired(
      'Your 9-day free trial has expired. Subscribe to continue creating records.',
      'TRIAL_EXPIRED'
    );
  }

  if (effectiveStatus !== 'TRIALING') {
    // Paid active tier has plan-specific limits handled in billing module
    return;
  }

  if (resourceType === 'clients') {
    const count = await prisma.client.count({
      where: { businessId, deletedAt: null, isActive: true },
    });
    if (count >= TRIAL_LIMITS.MAX_CLIENTS) {
      throw ApiError.forbidden(
        `Free trial is limited to ${TRIAL_LIMITS.MAX_CLIENTS} active participant. Upgrade to Starter or Pro to add more participants.`,
        'TRIAL_CLIENT_LIMIT_REACHED'
      );
    }
  } else if (resourceType === 'shifts') {
    const count = await prisma.shift.count({
      where: { businessId },
    });
    if (count >= TRIAL_LIMITS.MAX_SHIFTS) {
      throw ApiError.forbidden(
        `Free trial limit of ${TRIAL_LIMITS.MAX_SHIFTS} shifts reached. Subscribe to log unlimited shifts.`,
        'TRIAL_SHIFT_LIMIT_REACHED'
      );
    }
  } else if (resourceType === 'invoices') {
    const count = await prisma.invoice.count({
      where: { businessId },
    });
    if (count >= TRIAL_LIMITS.MAX_INVOICES) {
      throw ApiError.forbidden(
        `Free trial limit of ${TRIAL_LIMITS.MAX_INVOICES} generated invoices reached. Subscribe to unlock full invoicing.`,
        'TRIAL_INVOICE_LIMIT_REACHED'
      );
    }
  }
}
