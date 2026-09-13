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

function weekWindow(businessTimezone: string, weeksAgo: 0 | 1) {
  const now = DateTime.now().setZone(businessTimezone);
  const monday = now.startOf('week').minus({ weeks: weeksAgo }); // luxon startOf('week') = Monday
  const sunday = monday.plus({ days: 6 }).endOf('day');
  return { start: monday.toISODate()!, end: sunday.toISODate()! };
}

export async function getDashboardSummary(ctx: ActorContext) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  const tz = business.timezone;

  const shiftScope: Prisma.ShiftWhereInput = { businessId: ctx.businessId };
  if (ctx.role === 'TECHNICIAN') shiftScope.userId = ctx.userId;

  const thisWeek = weekWindow(tz, 0);
  const lastWeek = weekWindow(tz, 1);

  const [thisWeekAgg, lastWeekAgg, uninvoicedAgg, activeParticipants, recentShifts, budgetClients] = await Promise.all([
    prisma.shift.aggregate({
      where: { ...shiftScope, status: { not: 'CANCELLED' }, shiftDate: { gte: thisWeek.start, lte: thisWeek.end } },
      _sum: { totalAmount: true },
      _count: true,
    }),
    prisma.shift.aggregate({
      where: { ...shiftScope, status: { not: 'CANCELLED' }, shiftDate: { gte: lastWeek.start, lte: lastWeek.end } },
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
  ]);

  const thisWeekHoursAgg = await prisma.shiftLineItem.aggregate({
    where: {
      businessId: ctx.businessId,
      unit: 'Hour',
      shift: { ...shiftScope, status: { not: 'CANCELLED' }, shiftDate: { gte: thisWeek.start, lte: thisWeek.end } },
    },
    _sum: { quantity: true },
  });

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
    const shiftsUsed = await prisma.shift.count({ where: { businessId: ctx.businessId, status: { not: 'CANCELLED' } } });
    const trialEndsAt = DateTime.fromJSDate(business.trialEndsAt).setZone(tz);
    const daysRemaining = Math.max(0, Math.ceil(trialEndsAt.diff(DateTime.now().setZone(tz), 'days').days));
    trial = {
      status: daysRemaining > 0 ? 'TRIALING' : 'EXPIRED',
      daysRemaining,
      shiftsUsed,
      shiftsLimit: 5, // TRIAL_LIMITS.MAX_SHIFTS
    };
  }

  return {
    thisWeek: {
      earnings,
      hours: Number((thisWeekHoursAgg._sum.quantity ?? new Prisma.Decimal(0)).toFixed(2)),
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
