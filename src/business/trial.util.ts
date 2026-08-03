import { env } from '../config/env';
import { BusinessStatus } from '@prisma/client';

/**
 * GLOBAL-RULES §2 — "Every newly registered business automatically receives
 * a 3-Day Free Trial... The trial expires automatically after 72 hours."
 */
export function computeTrialEndDate(from: Date = new Date()): Date {
  const trialEnd = new Date(from);
  trialEnd.setHours(trialEnd.getHours() + env.TRIAL_DURATION_HOURS);
  return trialEnd;
}

/**
 * GLOBAL-RULES §3 — when the trial expires without a paid subscription, the
 * business becomes Read-Only (login remains available; data is preserved;
 * new appointments / AI requests are blocked in the modules that own them).
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
