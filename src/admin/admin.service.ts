import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { recordAuditEvent } from '../audit/audit.service';
import { buildPaginationMeta, paginationSkip } from '../utils/pagination';
import { RequestMeta } from '../auth/auth.service';
import {
  ListBusinessesQuery,
  ListUsersQuery,
  UpdateBusinessStatusInput,
  ExtendTrialInput,
} from './admin.validators';

/**
 * Super Admin Platform Metrics.
 * Provides global counts across tenants, users, trials, and invoices.
 */
export async function getPlatformOverviewMetrics() {
  const [
    totalBusinesses,
    totalUsers,
    trialingBusinesses,
    activeBusinesses,
    readOnlyBusinesses,
    suspendedBusinesses,
    totalInvoices,
    totalShifts,
    recentRegistrations,
  ] = await Promise.all([
    prisma.business.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.business.count({ where: { status: 'TRIALING', deletedAt: null } }),
    prisma.business.count({ where: { status: 'ACTIVE', deletedAt: null } }),
    prisma.business.count({ where: { status: 'READ_ONLY', deletedAt: null } }),
    prisma.business.count({ where: { status: 'SUSPENDED', deletedAt: null } }),
    prisma.invoice.count(),
    prisma.shift.count(),
    prisma.business.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  // Aggregate invoice totals if invoices exist
  const invoiceAggregate = await prisma.invoice.aggregate({
    _sum: {
      totalAmount: true,
    },
  });

  const totalRevenue = Number(invoiceAggregate._sum.totalAmount || 0);

  return {
    overview: {
      totalBusinesses,
      totalUsers,
      totalInvoices,
      totalShifts,
      totalRevenueVolume: totalRevenue,
      recentRegistrations7Days: recentRegistrations,
    },
    tenantsByStatus: {
      trialing: trialingBusinesses,
      active: activeBusinesses,
      readOnly: readOnlyBusinesses,
      suspended: suspendedBusinesses,
    },
    serverHealth: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV || 'development',
    },
  };
}

/**
 * Lists all registered businesses with pagination, searching, and filtering.
 */
export async function listAllBusinesses(query: ListBusinessesQuery) {
  const where: any = { deletedAt: null };

  if (query.status) {
    where.status = query.status;
  }

  if (query.search) {
    const term = query.search.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { email: { contains: term, mode: 'insensitive' } },
      { abn: { contains: term } },
      { phone: { contains: term } },
    ];
  }

  const [records, totalRecords] = await Promise.all([
    prisma.business.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        industry: true,
        abn: true,
        bsb: true,
        accountNumber: true,
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
        hasUsedTrial: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            users: true,
            clients: true,
            shifts: true,
            invoices: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: paginationSkip(query.page, query.pageSize),
      take: query.pageSize,
    }),
    prisma.business.count({ where }),
  ]);

  const formattedRecords = records.map((b) => {
    const daysRemaining = Math.max(
      0,
      Math.ceil((new Date(b.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    );
    return {
      ...b,
      trialDaysRemaining: daysRemaining,
      isTrialExpired: daysRemaining === 0,
      counts: {
        users: b._count.users,
        clients: b._count.clients,
        shifts: b._count.shifts,
        invoices: b._count.invoices,
      },
    };
  });

  return {
    records: formattedRecords,
    pagination: buildPaginationMeta(query.page, query.pageSize, totalRecords),
  };
}

/**
 * Retrieves detailed info for a specific business.
 */
export async function getBusinessDetails(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      users: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          lastLoginAt: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          clients: true,
          shifts: true,
          invoices: true,
        },
      },
    },
  });

  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const daysRemaining = Math.max(
    0,
    Math.ceil((new Date(business.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return {
    ...business,
    trialDaysRemaining: daysRemaining,
  };
}

/**
 * Updates a business's operational status (e.g. SUSPENDED, ACTIVE, TRIALING).
 */
export async function updateBusinessStatus(
  businessId: string,
  input: UpdateBusinessStatusInput,
  actingUserId: string,
  meta: RequestMeta
) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: { status: input.status },
  });

  await recordAuditEvent({
    action: 'SUPER_ADMIN_BUSINESS_STATUS_UPDATED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      previousStatus: business.status,
      newStatus: input.status,
      reason: input.reason,
    },
  });

  return updated;
}

/**
 * Extends the trial duration for a business.
 */
export async function extendBusinessTrial(
  businessId: string,
  input: ExtendTrialInput,
  actingUserId: string,
  meta: RequestMeta
) {
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) {
    throw ApiError.notFound('Business not found.');
  }

  const baseDate = business.trialEndsAt.getTime() > Date.now() ? business.trialEndsAt : new Date();
  const newTrialEndsAt = new Date(baseDate.getTime() + input.days * 24 * 60 * 60 * 1000);

  const updated = await prisma.business.update({
    where: { id: businessId },
    data: {
      trialEndsAt: newTrialEndsAt,
      status: business.status === 'READ_ONLY' ? 'TRIALING' : business.status,
    },
  });

  await recordAuditEvent({
    action: 'SUPER_ADMIN_TRIAL_EXTENDED',
    businessId,
    userId: actingUserId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    metadata: {
      addedDays: input.days,
      newTrialEndsAt,
    },
  });

  const daysRemaining = Math.max(
    0,
    Math.ceil((newTrialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return {
    ...updated,
    trialDaysRemaining: daysRemaining,
  };
}

/**
 * Lists all users across the entire platform.
 */
export async function listAllUsers(query: ListUsersQuery) {
  const where: any = { deletedAt: null };

  if (query.role) where.role = query.role;
  if (query.status) where.status = query.status;

  if (query.search) {
    const term = query.search.trim();
    where.OR = [
      { email: { contains: term, mode: 'insensitive' } },
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
      { business: { name: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const [records, totalRecords] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        business: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
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

/**
 * Platform-wide immutable audit trail.
 */
export async function getPlatformAuditLogs(page = 1, pageSize = 30) {
  const [records, totalRecords] = await Promise.all([
    prisma.auditLog.findMany({
      select: {
        id: true,
        action: true,
        ipAddress: true,
        userAgent: true,
        metadata: true,
        createdAt: true,
        business: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: paginationSkip(page, pageSize),
      take: pageSize,
    }),
    prisma.auditLog.count(),
  ]);

  return {
    records,
    pagination: buildPaginationMeta(page, pageSize, totalRecords),
  };
}
