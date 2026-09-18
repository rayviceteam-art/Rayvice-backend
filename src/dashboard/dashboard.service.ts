/**
 * MODULE 4 — dashboard summary
 * src/dashboard/dashboard.service.ts
 * Section 12.8 / decision D17 — six widgets in one round trip.
 */
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../config/database';
import { toShiftView, budgetBlock } from '../shifts/shift.mapper';
import { ActorContext } from '../shifts/shift.service';
import { logger } from '../config/logger';

const DEFAULT_TIMEZONE = 'Australia/Sydney';

function weekWindow(businessTimezone: string | null, weeksAgo: 0 | 1) {
  const tz = businessTimezone || DEFAULT_TIMEZONE;
  const now = DateTime.now().setZone(tz);
  const monday = now.startOf('week').minus({ weeks: weeksAgo });
  const sunday = monday.plus({ days: 6 }).endOf('day');
  return { start: monday.toISO()!, end: sunday.toISO()! };
}

export async function getDashboardSummary(ctx: ActorContext) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  const tz = business.timezone || DEFAULT_TIMEZONE;

  const shiftScope: Prisma.ShiftWhereInput = { businessId: ctx.businessId };
  if (ctx.role === 'TECHNICIAN') shiftScope.userId = ctx.userId;

  const thisWeek = weekWindow(tz, 0);
  const lastWeek = weekWindow(tz, 1);

  const thisWeekShiftWhere: Prisma.ShiftWhereInput = {
    ...shiftScope,
    status: { not: 'CANCELLED' },
    shiftDate: { gte: thisWeek.start, lte: thisWeek.end },
  };

  const lastWeekShiftWhere: Prisma.ShiftWhereInput = {
    ...shiftScope,
    status: { not: 'CANCELLED' },
    shiftDate: { gte: lastWeek.start, lte: lastWeek.end },
  };

  let thisWeekAgg: any;
  let lastWeekAgg: any;
  let uninvoicedAgg: any;
  let activeParticipants: number = 0;
  let recentShifts: any[] = [];
  let budgetClients: any[] = [];
  let trialShiftsUsed: number = 0;

  try {
    [thisWeekAgg, lastWeekAgg, uninvoicedAgg, activeParticipants, recentShifts, budgetClients, trialShiftsUsed] = await Promise.all([
      prisma.shift.aggregate({
        where: thisWeekShiftWhere,
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.shift.aggregate({
        where: lastWeekShiftWhere,
        _sum: { totalAmount: true },
      }),
      prisma.shift.aggregate({
        where: { ...shiftScope, status: 'PENDING' },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.client.count({ where: { businessId: ctx.businessId, isActive: true, deletedAt: null } }),
      prisma.shift.findMany({
        where: shiftScope,
        include: { client: true, lineItems: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      prisma.client.findMany({
        where: { businessId: ctx.businessId, isActive: true, deletedAt: null, allocatedBudgetTotal: { not: null } },
      }),
      // Trial quota count rides the same batch — saves a sequential round trip.
      business.planTier === 'TRIAL'
        ? prisma.shift.count({ where: { businessId: ctx.businessId, status: { not: 'CANCELLED' } } })
        : Promise.resolve(0),
    ]);
  } catch (err) {
    logger.error('Dashboard batch query failed', { businessId: ctx.businessId, error: err instanceof Error ? err.message : err });
    throw err;
  }

  let thisWeekHoursQuantity: number = 0;
  try {
    const thisWeekShiftIds = await prisma.shift.findMany({
      where: thisWeekShiftWhere,
      select: { id: true },
    });
    const ids = thisWeekShiftIds.map((s) => s.id);
    if (ids.length > 0) {
      const hoursAgg = await prisma.shiftLineItem.aggregate({
        where: { businessId: ctx.businessId, unit: 'Hour', shiftId: { in: ids } },
        _sum: { quantity: true },
      });
      thisWeekHoursQuantity = Number((hoursAgg._sum.quantity ?? new Prisma.Decimal(0)).toFixed(2));
    }
  } catch (err) {
    logger.error('Dashboard hours query failed', { businessId: ctx.businessId, error: err instanceof Error ? err.message : err });
  }

  const earnings = Number((thisWeekAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2));
  const previousWeekEarnings = Number((lastWeekAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2));
  const changePercent =
    previousWeekEarnings === 0 ? null : Number((((earnings - previousWeekEarnings) / previousWeekEarnings) * 100).toFixed(1));

  const budgetWatch = budgetClients
    .map((c) => {
      const spent = c.allocatedBudgetSpent ?? new Prisma.Decimal(0);
      const block = budgetBlock(spent, c.allocatedBudgetTotal);
      return {
        clientId: c.id,
        participantName: c.participantName,
        allocatedTotal: block.allocatedTotal,
        allocatedSpent: block.allocatedSpent,
        utilizationPercent: block.utilizationPercent,
        level: block.level,
      };
    })
    .filter((b) => b.utilizationPercent >= 70)
    .sort((a, b) => b.utilizationPercent - a.utilizationPercent)
    .slice(0, 10);

  let trial: {
    status: string;
    daysRemaining: number;
    shiftsUsed: number;
    shiftsLimit: number;
  } | null = null;

  if (business.planTier === 'TRIAL') {
    const shiftsUsed = trialShiftsUsed;
    const trialEndsAt = business.trialEndsAt
      ? DateTime.fromJSDate(business.trialEndsAt).setZone(tz)
      : null;
    const daysRemaining = trialEndsAt ? Math.max(0, Math.ceil(trialEndsAt.diff(DateTime.now().setZone(tz), 'days').days)) : 0;
    trial = {
      status: daysRemaining > 0 ? 'TRIALING' : 'EXPIRED',
      daysRemaining,
      shiftsUsed,
      shiftsLimit: 5,
    };
  }

  return {
    thisWeek: {
      earnings,
      hours: thisWeekHoursQuantity,
      shiftCount: thisWeekAgg._count,
      previousWeekEarnings,
      changePercent,
    },
    uninvoiced: {
      shiftCount: uninvoicedAgg._count,
      totalAmount: Number((uninvoicedAgg._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    },
    activeParticipants,
    recentShifts: recentShifts.map((s) => toShiftView(s as any)),
    budgetWatch,
    trial,
  };
}
