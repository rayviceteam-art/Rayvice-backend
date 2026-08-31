import { prisma } from '../config/database';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/token';
import { sendEmail } from '../utils/email.service';
import { recordAuditEvent } from '../audit/audit.service';
import { hashPassword } from '../utils/password';
import { buildPaginationMeta, paginationSkip } from '../utils/pagination';
import { deriveEffectiveBusinessStatus, getTrialDetails, assertCanMutate } from './trial.util';
import { RequestMeta } from '../auth/auth.service';
import {
  InviteTeamMemberInput,
  AcceptInviteInput,
  ListTeamQuery,
  UpdateBusinessProfileInput,
  UpdateBankDetailsInput,
} from './business.validators';
import {
  validateAbn,
  validateAndFormatBsb,
  validateAccountNumber,
  evaluateComplianceReadiness,
  ComplianceReport,
} from './australianCompliance.util';

const teamMemberSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  status: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

const businessProfileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  industry: true,
  abn: true,
  bsb: true,
  accountNumber: true,
  accountName: true,
  bankName: true,
  invoicePrefix: true,
  isGstRegistered: true,
  address: true,
  suburb: true,
  state: true,
  postcode: true,
  status: true,
  trialStartedAt: true,
  trialEndsAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Invites a new Office Manager or Technician into the acting Owner's business.
 * BACKEND-03 §3 — "Team Management" is an Owner-only permission.
 */
export async function inviteTeamMember(businessId: string, input: InviteTeamMemberInput, meta: RequestMeta) {
  await assertCanMutate(businessId);

  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) {
    throw ApiError.conflict('A user with this email already exists.', 'EMAIL_ALREADY_REGISTERED');
  }

  // Invited users get a random, unusable placeholder password hash; they set
  // a real password when accepting the invite via a single-use token.
  const placeholderPasswordHash = await hashPassword(generateOpaqueToken().rawToken);

  const invitedUser = await prisma.user.create({
    data: {
      businessId,
      email: input.email,
      passwordHash: placeholderPasswordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role,
      status: 'INVITED',
    },
    select: teamMemberSelect,
  });

  const { rawToken, tokenHash } = generateOpaqueToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + env.INVITE_TOKEN_TTL_HOURS);

  await prisma.invitationToken.create({
    data: { userId: invitedUser.id, tokenHash, expiresAt },
  });

  const inviteUrl = `${env.CLIENT_URL}/accept-invite?token=${rawToken}`;

  await sendEmail({
    to: invitedUser.email,
    subject: "You've been invited to join Rayvice",
    html: `<p>Hi ${invitedUser.firstName},</p><p>You have been invited to join your team on Rayvice as a ${input.role === 'OFFICE_MANAGER' ? 'Office Manager' : 'Support Worker / Team Member'}.</p><p><a href="${inviteUrl}">${inviteUrl}</a></p><p>This invitation expires in ${env.INVITE_TOKEN_TTL_HOURS} hours.</p>`,
    text: `You've been invited to join Rayvice. Accept your invite: ${inviteUrl} (expires in ${env.INVITE_TOKEN_TTL_HOURS} hours)`,
  });

  await recordAuditEvent({
    action: 'USER_INVITED',
    businessId,
    userId: invitedUser.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { invitedEmail: invitedUser.email, role: invitedUser.role },
  });

  return invitedUser;
}

/**
 * Completes onboarding for an invited Office Manager / Technician: sets
 * their password and activates the account.
 */
export async function acceptInvite(input: AcceptInviteInput, meta: RequestMeta) {
  const tokenHash = hashOpaqueToken(input.token);
  const record = await prisma.invitationToken.findUnique({ where: { tokenHash }, include: { user: true } });

  if (!record || record.consumedAt || record.expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest('This invitation link is invalid or has expired.', 'INVALID_INVITE_TOKEN');
  }

  if (record.user.status !== 'INVITED') {
    throw ApiError.conflict('This invitation has already been accepted.', 'INVITE_ALREADY_ACCEPTED');
  }

  const passwordHash = await hashPassword(input.password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, status: 'ACTIVE', emailVerifiedAt: new Date() },
    }),
    prisma.invitationToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
  ]);

  await recordAuditEvent({
    action: 'USER_INVITE_ACCEPTED',
    businessId: record.user.businessId,
    userId: record.userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Lists team members within the acting user's business only.
 * GLOBAL-RULES §7 — "Businesses cannot access each other's data."
 * BACKEND-04 §9 — supports pagination.
 */
export async function listTeamMembers(businessId: string, query: ListTeamQuery) {
  const where = {
    businessId,
    deletedAt: null,
    ...(query.role ? { role: query.role } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [records, totalRecords] = await Promise.all([
    prisma.user.findMany({
      where,
      select: teamMemberSelect,
      orderBy: { createdAt: 'desc' },
      skip: paginationSkip(query.page, query.pageSize),
      take: query.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return {
    records,
    pagination: buildPaginationMeta(query.page, query.pageSize, totalRecords),
  };
}

async function assertUserBelongsToBusiness(businessId: string, userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.businessId !== businessId) {
    throw ApiError.notFound('Team member not found.');
  }
  return user;
}

export async function suspendTeamMember(businessId: string, targetUserId: string, actingUserId: string, meta: RequestMeta) {
  await assertCanMutate(businessId);

  if (targetUserId === actingUserId) {
    throw ApiError.badRequest('You cannot suspend your own account.', 'CANNOT_SUSPEND_SELF');
  }

  const user = await assertUserBelongsToBusiness(businessId, targetUserId);
  if (user.role === 'OWNER') {
    throw ApiError.forbidden('The business owner cannot be suspended.', 'CANNOT_SUSPEND_OWNER');
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: targetUserId }, data: { status: 'SUSPENDED' } }),
    prisma.refreshToken.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);

  await recordAuditEvent({
    action: 'USER_SUSPENDED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId },
  });
}

export async function reactivateTeamMember(businessId: string, targetUserId: string, actingUserId: string, meta: RequestMeta) {
  await assertCanMutate(businessId);

  const user = await assertUserBelongsToBusiness(businessId, targetUserId);
  if (user.status !== 'SUSPENDED') {
    throw ApiError.badRequest('Only suspended team members can be reactivated.', 'USER_NOT_SUSPENDED');
  }

  await prisma.user.update({ where: { id: targetUserId }, data: { status: 'ACTIVE' } });

  await recordAuditEvent({
    action: 'USER_REACTIVATED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { targetUserId },
  });
}

// =============================================================================
// MODULE 2: Business Profile, Australian Compliance & Banking Services
// =============================================================================

/**
 * Retrieves the comprehensive business profile, Australian compliance parameters,
 * bank payment details, and trial status.
 */
export async function getBusinessProfile(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: businessProfileSelect,
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const effectiveStatus = deriveEffectiveBusinessStatus(business);
  const trial = getTrialDetails(business);
  const compliance = evaluateComplianceReadiness(business);

  // Formatted representations
  const formattedAbn = business.abn ? validateAbn(business.abn).formatted || business.abn : null;
  const formattedBsb = business.bsb ? validateAndFormatBsb(business.bsb).formatted || business.bsb : null;

  return {
    ...business,
    formattedAbn,
    formattedBsb,
    effectiveStatus,
    trial,
    compliance,
  };
}

/**
 * Updates business profile, Australian tax settings, and banking details.
 * Restricted to OWNER role.
 */
export async function updateBusinessProfile(
  businessId: string,
  input: UpdateBusinessProfileInput,
  actingUserId: string,
  meta: RequestMeta
) {
  await assertCanMutate(businessId);

  // Sanitize & normalize fields
  const updateData: Record<string, unknown> = {};

  if (input.name !== undefined) updateData.name = input.name;
  if (input.phone !== undefined) updateData.phone = input.phone;
  if (input.industry !== undefined) updateData.industry = input.industry;

  if (input.abn !== undefined) {
    if (input.abn === null || input.abn === '') {
      updateData.abn = null;
    } else {
      const abnCheck = validateAbn(input.abn);
      if (!abnCheck.isValid) {
        throw ApiError.badRequest(abnCheck.error || 'Invalid Australian Business Number (ABN).', 'INVALID_ABN');
      }
      updateData.abn = abnCheck.digits;
    }
  }

  if (input.bsb !== undefined) {
    if (input.bsb === null || input.bsb === '') {
      updateData.bsb = null;
    } else {
      const bsbCheck = validateAndFormatBsb(input.bsb);
      if (!bsbCheck.isValid) {
        throw ApiError.badRequest(bsbCheck.error || 'Invalid BSB code.', 'INVALID_BSB');
      }
      updateData.bsb = bsbCheck.formatted;
      // Auto-set bankName if not provided and not currently set
      if (!input.bankName && bsbCheck.bankName) {
        updateData.bankName = bsbCheck.bankName;
      }
    }
  }

  if (input.accountNumber !== undefined) {
    if (input.accountNumber === null || input.accountNumber === '') {
      updateData.accountNumber = null;
    } else {
      const accCheck = validateAccountNumber(input.accountNumber);
      if (!accCheck.isValid) {
        throw ApiError.badRequest(accCheck.error || 'Invalid account number.', 'INVALID_ACCOUNT_NUMBER');
      }
      updateData.accountNumber = accCheck.digits;
    }
  }

  if (input.accountName !== undefined) updateData.accountName = input.accountName;
  if (input.bankName !== undefined) updateData.bankName = input.bankName;
  if (input.invoicePrefix !== undefined) updateData.invoicePrefix = input.invoicePrefix.toUpperCase();
  if (input.isGstRegistered !== undefined) updateData.isGstRegistered = input.isGstRegistered;
  if (input.address !== undefined) updateData.address = input.address;
  if (input.suburb !== undefined) updateData.suburb = input.suburb;
  if (input.state !== undefined) updateData.state = input.state;
  if (input.postcode !== undefined) updateData.postcode = input.postcode;

  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: updateData,
    select: businessProfileSelect,
  });

  await recordAuditEvent({
    action: 'BUSINESS_PROFILE_UPDATED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { updatedFields: Object.keys(updateData) },
  });

  const effectiveStatus = deriveEffectiveBusinessStatus(updatedBusiness);
  const trial = getTrialDetails(updatedBusiness);
  const compliance = evaluateComplianceReadiness(updatedBusiness);

  return {
    ...updatedBusiness,
    effectiveStatus,
    trial,
    compliance,
  };
}

/**
 * Retrieves EFT remittance banking details specifically.
 */
export async function getBankDetails(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      bsb: true,
      accountNumber: true,
      accountName: true,
      bankName: true,
      isGstRegistered: true,
      abn: true,
    },
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const bsbValidation = business.bsb ? validateAndFormatBsb(business.bsb) : null;
  const isConfigured = Boolean(business.bsb && business.accountNumber);

  return {
    isConfigured,
    bsb: business.bsb,
    formattedBsb: bsbValidation?.formatted || business.bsb,
    accountNumber: business.accountNumber,
    accountName: business.accountName || business.name,
    bankName: business.bankName || bsbValidation?.bankName || null,
    abn: business.abn,
  };
}

/**
 * Updates EFT bank details specifically.
 */
export async function updateBankDetails(
  businessId: string,
  input: UpdateBankDetailsInput,
  actingUserId: string,
  meta: RequestMeta
) {
  await assertCanMutate(businessId);

  const bsbCheck = validateAndFormatBsb(input.bsb);
  if (!bsbCheck.isValid) {
    throw ApiError.badRequest(bsbCheck.error || 'Invalid BSB code.', 'INVALID_BSB');
  }

  const accCheck = validateAccountNumber(input.accountNumber);
  if (!accCheck.isValid) {
    throw ApiError.badRequest(accCheck.error || 'Invalid account number.', 'INVALID_ACCOUNT_NUMBER');
  }

  const bankName = input.bankName || bsbCheck.bankName || 'Australian Financial Institution';

  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: {
      bsb: bsbCheck.formatted,
      accountNumber: accCheck.digits,
      accountName: input.accountName,
      bankName,
    },
    select: {
      id: true,
      bsb: true,
      accountNumber: true,
      accountName: true,
      bankName: true,
      updatedAt: true,
    },
  });

  await recordAuditEvent({
    action: 'BANK_DETAILS_UPDATED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: { bsb: bsbCheck.formatted, bankName },
  });

  return {
    isConfigured: true,
    ...updatedBusiness,
  };
}

/**
 * Evaluates Pre-Flight compliance readiness for NDIS invoicing.
 */
export async function getComplianceStatus(businessId: string): Promise<ComplianceReport> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: businessProfileSelect,
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  return evaluateComplianceReadiness(business);
}

/**
 * Helper to validate an Australian ABN via ATO algorithm.
 */
export function validateAbnHelper(abn: string) {
  return validateAbn(abn);
}
