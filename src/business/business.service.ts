import { prisma } from '../config/database';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/token';
import { sendEmail } from '../utils/email.service';
import { recordAuditEvent } from '../audit/audit.service';
import { hashPassword } from '../utils/password';
import { buildPaginationMeta, paginationSkip } from '../utils/pagination';
import { deriveEffectiveBusinessStatus } from './trial.util';
import { RequestMeta } from '../auth/auth.service';
import { InviteTeamMemberInput, AcceptInviteInput, ListTeamQuery, UpdateBusinessInput } from './business.validators';

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

/**
 * Invites a new Office Manager or Technician into the acting Owner's business.
 * BACKEND-03 §3 — "Team Management" is an Owner-only permission.
 */
export async function inviteTeamMember(businessId: string, input: InviteTeamMemberInput, meta: RequestMeta) {
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

export async function getBusinessProfile(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      industry: true,
      status: true,
      trialStartedAt: true,
      trialEndsAt: true,
      createdAt: true,
    },
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  return { ...business, effectiveStatus: deriveEffectiveBusinessStatus(business) };
}

/**
 * Updates business profile fields. Restricted to Owner (Settings permission,
 * BACKEND-03 §3).
 */
export async function updateBusinessProfile(businessId: string, input: UpdateBusinessInput) {
  const business = await prisma.business.update({
    where: { id: businessId },
    data: input,
    select: { id: true, name: true, email: true, phone: true, industry: true, status: true, updatedAt: true },
  });

  return business;
}
