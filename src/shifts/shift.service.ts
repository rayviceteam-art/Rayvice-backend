/**
 * MODULE 4 — shift service
 * src/shifts/shift.service.ts
 *
 * Orchestrates: trial/plan gates -> client/support-item resolution ->
 * overlap/duplicate checks -> engine -> transactional persistence ->
 * budget recompute -> audit log. The engine itself (shift.engine.ts) stays
 * pure; all I/O lives here.
 */
import { Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { assertCanMutate, checkTrialResourceLimit } from '../business/trial.util';
import { recordAuditEvent } from '../audit/audit.service';
import { calculateShift } from './shift.engine';
import { buildHolidayChecker } from './holiday.service';
import { loadRateTable, resolveSupportItem } from './rateTable.loader';
import { assertShiftDateInWindow, CreateShiftBody, UpdateShiftBody, ListShiftsQuery } from './shift.validators';
import { toShiftView, budgetBlock } from './shift.mapper';
import { recalculateClientBudgetSpent } from '../clients/client.service';

export interface ActorContext {
  businessId: string;
  userId: string;
  role: 'OWNER' | 'OFFICE_MANAGER' | 'TECHNICIAN' | 'SUPER_ADMIN';
}

function assertVisibility(ctx: ActorContext, shiftOwnerId: string) {
  if (ctx.role === 'TECHNICIAN' && shiftOwnerId !== ctx.userId) {
    throw ApiError.forbidden('You may only access your own shifts', 'FORBIDDEN');
  }
}

async function getBusinessOrThrow(businessId: string) {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  return business;
}

async function getActiveClientOrThrow(clientId: string, businessId: string) {
  const client = await prisma.client.findFirst({ where: { id: clientId, businessId, deletedAt: null } });
  if (!client) throw ApiError.notFound('Client not found', 'CLIENT_NOT_FOUND');
  if (!client.isActive) throw ApiError.unprocessable('Client is not active', 'CLIENT_INACTIVE');
  return client;
}

async function assertNoOverlapOrDuplicate(
  businessId: string,
  userId: string,
  clientId: string,
  startAt: Date,
  endAt: Date,
  excludeShiftId?: string,
) {
  const overlap = await prisma.shift.findFirst({
    where: {
      businessId,
      userId,
      status: { not: 'CANCELLED' },
      id: excludeShiftId ? { not: excludeShiftId } : undefined,
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  if (overlap) {
    throw ApiError.conflict('This shift overlaps another shift for this worker', 'SHIFT_OVERLAP', {
      conflictingShiftId: overlap.id,
    });
  }

  const duplicate = await prisma.shift.findFirst({
    where: {
      businessId,
      userId,
      clientId,
      status: { not: 'CANCELLED' },
      startAt,
      id: excludeShiftId ? { not: excludeShiftId } : undefined,
    },
  });
  if (duplicate) {
    throw ApiError.conflict('An identical shift already exists', 'DUPLICATE_SHIFT', {
      conflictingShiftId: duplicate.id,
    });
  }
}

const SHIFT_INCLUDE = { client: true, lineItems: true } as const;

/**
 * Prisma's DateTime arguments require a FULL ISO-8601 instant. A bare
 * "YYYY-MM-DD" string passes the generated types but is rejected at runtime
 * with PrismaClientValidationError ("premature end of input"), which surfaced
 * as a 500 on POST /shifts. Always convert date-only input to a Date first.
 */
function toDbDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/** Section 12.1 — POST /shifts */
export async function createShift(ctx: ActorContext, body: CreateShiftBody, idempotencyKey?: string) {
  await assertCanMutate(ctx.businessId);

  if (idempotencyKey) {
    const existing = await prisma.shift.findFirst({
      where: { businessId: ctx.businessId, idempotencyKey },
      include: SHIFT_INCLUDE,
    });
    if (existing) {
      const budget = await currentBudget(existing.clientId, ctx.businessId);
      return { shift: toShiftView(existing as any), budget, warnings: [], idempotentReplay: true };
    }
  }

  await checkTrialResourceLimit(ctx.businessId, 'shifts');

  const business = await getBusinessOrThrow(ctx.businessId);
  const client = await getActiveClientOrThrow(body.clientId, ctx.businessId);

  assertShiftDateInWindow(body.shiftDate, business.timezone);

  const { itemCode, travelAllowed } = await resolveSupportItem(body.supportItemCode, client.defaultSupportItemCode);
  const rateTable = await loadRateTable(client.hourlyRateAgreed ?? null, travelAllowed);
  const holidayChecker = buildHolidayChecker(business.state);

  const result = calculateShift(
    {
      date: body.shiftDate,
      startTime: body.startTime,
      endTime: body.endTime,
      travelKms: body.travelKms ?? null,
      timezone: business.timezone,
      isPublicHoliday: body.isPublicHoliday ?? null,
    },
    rateTable,
    holidayChecker,
  );

  await assertNoOverlapOrDuplicate(ctx.businessId, ctx.userId, body.clientId, result.startAt, result.endAt);

  const created = await prisma.$transaction(async (tx) => {
    const shift = await tx.shift.create({
      data: {
        businessId: ctx.businessId,
        userId: ctx.userId,
        clientId: body.clientId,
        shiftDate: toDbDate(body.shiftDate),
        startTime: body.startTime,
        endTime: body.endTime,
        totalHours: result.totalHours,
        travelKms: body.travelKms ?? 0,
        caseNotes: body.caseNotes ?? null,
        supportItemCode: itemCode,
        status: 'PENDING',
        isInvoiced: false,
        startAt: result.startAt,
        endAt: result.endAt,
        timezoneUsed: result.timezoneUsed,
        totalAmount: result.grandTotal,
        hourlyRateApplied: result.lines.find((l) => l.unit === 'Hour')?.appliedRate ?? null,
        isPublicHoliday: result.isPublicHoliday,
        publicHolidayName: result.publicHolidayName,
        holidaySource: result.holidaySource,
        calculatedAt: new Date(),
        idempotencyKey: idempotencyKey ?? null,
      },
    });

    await tx.shiftLineItem.createMany({
      data: result.lines.map((l) => ({
        shiftId: shift.id,
        businessId: ctx.businessId,
        rateTier: l.rateTier,
        supportItemCode: l.supportItemCode,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        ndisCapRate: l.ndisCapRate,
        appliedRate: l.appliedRate,
        amount: l.amount,
        segmentStart: l.segmentStart,
        segmentEnd: l.segmentEnd,
        sortOrder: l.sortOrder,
      })),
    });

    return tx.shift.findUniqueOrThrow({ where: { id: shift.id }, include: SHIFT_INCLUDE });
  });

  const spent = await recalculateClientBudgetSpent(body.clientId, ctx.businessId);
  const budget = budgetBlock(spent, client.allocatedBudgetTotal ?? null);

  await recordAuditEvent({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: 'SHIFT_LOGGED',
    metadata: {
      shiftId: created.id,
      clientId: body.clientId,
      supportItemCode: itemCode,
      totalHours: result.totalHours.toString(),
      travelKms: result.travelKms.toString(),
      totalAmount: result.grandTotal.toString(),
      rateTiers: [...new Set(result.lines.map((l) => l.rateTier))],
      isPublicHoliday: result.isPublicHoliday,
      holidaySource: result.holidaySource,
      voiceAssisted: false,
      idempotentReplay: false,
    },
  });

  const warnings = [...result.warnings];
  if (budget.level === 'EXHAUSTED') warnings.push('BUDGET_EXHAUSTED');

  return { shift: toShiftView(created as any), budget, warnings, idempotentReplay: false };
}

async function currentBudget(clientId: string, businessId: string) {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  return budgetBlock(client.allocatedBudgetSpent ?? new Prisma.Decimal(0), client.allocatedBudgetTotal ?? null);
}

/** Section 12.2 — GET /shifts */
export async function listShifts(ctx: ActorContext, query: ListShiftsQuery) {
  const where: Prisma.ShiftWhereInput = { businessId: ctx.businessId };
  if (ctx.role === 'TECHNICIAN') {
    where.userId = ctx.userId;
  } else if (query.userId) {
    where.userId = query.userId;
  }
  if (query.clientId) where.clientId = query.clientId;
  if (query.status) where.status = query.status;
  if (query.isInvoiced !== undefined) where.isInvoiced = query.isInvoiced;
  if (query.from || query.to) {
    // Date-only strings must be converted to real Dates for Prisma (see toDbDate).
    where.shiftDate = {
      ...(query.from ? { gte: toDbDate(query.from) } : {}),
      ...(query.to ? { lte: toDbDate(query.to) } : {}),
    };
  }

  const [items, totalRecords, summary] = await Promise.all([
    prisma.shift.findMany({
      where,
      include: SHIFT_INCLUDE,
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.shift.count({ where }),
    prisma.shift.aggregate({ where, _sum: { totalAmount: true }, _count: true }),
  ]);

  const totalHoursAgg = await prisma.shiftLineItem.aggregate({
    where: { businessId: ctx.businessId, unit: 'Hour', shift: where as any },
    _sum: { quantity: true },
  });

  return {
    items: items.map((s) => toShiftView(s as any)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalRecords,
      totalPages: Math.ceil(totalRecords / query.pageSize),
    },
    summary: {
      totalAmount: Number((summary._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2)),
      totalHours: Number((totalHoursAgg._sum.quantity ?? new Prisma.Decimal(0)).toFixed(2)),
      count: summary._count,
    },
  };
}

/** Section 12.3 — GET /shifts/:id */
export async function getShiftById(ctx: ActorContext, id: string) {
  const shift = await prisma.shift.findFirst({ where: { id, businessId: ctx.businessId }, include: SHIFT_INCLUDE });
  if (!shift) throw ApiError.notFound('Shift not found', 'SHIFT_NOT_FOUND');
  assertVisibility(ctx, shift.userId);
  return { shift: toShiftView(shift as any) };
}

/** Section 12.4 — PATCH /shifts/:id */
export async function updateShift(ctx: ActorContext, id: string, body: UpdateShiftBody) {
  const existing = await prisma.shift.findFirst({ where: { id, businessId: ctx.businessId }, include: SHIFT_INCLUDE });
  if (!existing) throw ApiError.notFound('Shift not found', 'SHIFT_NOT_FOUND');
  assertVisibility(ctx, existing.userId);

  if (existing.status === 'INVOICED' || existing.isInvoiced) {
    throw ApiError.conflict('Invoiced shifts cannot be edited', 'SHIFT_ALREADY_INVOICED');
  }
  if (existing.status === 'CANCELLED') {
    throw ApiError.conflict('Cancelled shifts cannot be edited', 'SHIFT_CANCELLED');
  }

  await assertCanMutate(ctx.businessId);

  const business = await getBusinessOrThrow(ctx.businessId);
  const client = await getActiveClientOrThrow(existing.clientId, ctx.businessId);

  const merged = {
    shiftDate: body.shiftDate ?? existing.shiftDate,
    startTime: body.startTime ?? existing.startTime,
    endTime: body.endTime ?? existing.endTime,
    travelKms: body.travelKms !== undefined ? body.travelKms : existing.travelKms ? Number(existing.travelKms) : null,
    caseNotes: body.caseNotes !== undefined ? body.caseNotes : existing.caseNotes,
    isPublicHoliday: body.isPublicHoliday !== undefined ? body.isPublicHoliday : null,
    supportItemCode: body.supportItemCode ?? existing.supportItemCode,
  };

  assertShiftDateInWindow(merged.shiftDate as string, business.timezone);

  const { itemCode, travelAllowed } = await resolveSupportItem(merged.supportItemCode, client.defaultSupportItemCode);
  const rateTable = await loadRateTable(client.hourlyRateAgreed ?? null, travelAllowed);
  const holidayChecker = buildHolidayChecker(business.state);

  const result = calculateShift(
    {
      date: merged.shiftDate as string,
      startTime: merged.startTime as string,
      endTime: merged.endTime as string,
      travelKms: merged.travelKms,
      timezone: business.timezone,
      isPublicHoliday: merged.isPublicHoliday,
    },
    rateTable,
    holidayChecker,
  );

  await assertNoOverlapOrDuplicate(ctx.businessId, existing.userId, existing.clientId, result.startAt, result.endAt, id);

  const oldTotalAmount = existing.totalAmount ? existing.totalAmount.toString() : null;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.shift.update({
      where: { id },
      data: {
        shiftDate: toDbDate(merged.shiftDate as string),
        startTime: merged.startTime,
        endTime: merged.endTime,
        totalHours: result.totalHours,
        travelKms: merged.travelKms ?? 0,
        caseNotes: merged.caseNotes,
        supportItemCode: itemCode,
        startAt: result.startAt,
        endAt: result.endAt,
        timezoneUsed: result.timezoneUsed,
        totalAmount: result.grandTotal,
        hourlyRateApplied: result.lines.find((l) => l.unit === 'Hour')?.appliedRate ?? null,
        isPublicHoliday: result.isPublicHoliday,
        publicHolidayName: result.publicHolidayName,
        holidaySource: result.holidaySource,
        calculatedAt: new Date(),
      },
    });

    await tx.shiftLineItem.deleteMany({ where: { shiftId: id } });
    await tx.shiftLineItem.createMany({
      data: result.lines.map((l) => ({
        shiftId: id,
        businessId: ctx.businessId,
        rateTier: l.rateTier,
        supportItemCode: l.supportItemCode,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        ndisCapRate: l.ndisCapRate,
        appliedRate: l.appliedRate,
        amount: l.amount,
        segmentStart: l.segmentStart,
        segmentEnd: l.segmentEnd,
        sortOrder: l.sortOrder,
      })),
    });

    return tx.shift.findUniqueOrThrow({ where: { id }, include: SHIFT_INCLUDE });
  });

  const spent = await recalculateClientBudgetSpent(existing.clientId, ctx.businessId);
  const budget = budgetBlock(spent, client.allocatedBudgetTotal ?? null);

  const changedFields = Object.keys(body);
  await recordAuditEvent({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: 'SHIFT_UPDATED',
    metadata: { shiftId: id, changedFields, oldTotalAmount, newTotalAmount: result.grandTotal.toString() },
  });

  const warnings = [...result.warnings];
  if (budget.level === 'EXHAUSTED') warnings.push('BUDGET_EXHAUSTED');

  return { shift: toShiftView(updated as any), budget, warnings };
}

/** Section 12.5 — DELETE /shifts/:id (soft cancel, decision D14) */
export async function cancelShift(ctx: ActorContext, id: string) {
  const existing = await prisma.shift.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!existing) throw ApiError.notFound('Shift not found', 'SHIFT_NOT_FOUND');
  assertVisibility(ctx, existing.userId);

  if (existing.status === 'INVOICED' || existing.isInvoiced) {
    throw ApiError.conflict('Invoiced shifts cannot be deleted', 'SHIFT_ALREADY_INVOICED');
  }

  if (existing.status !== 'CANCELLED') {
    await prisma.shift.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await recalculateClientBudgetSpent(existing.clientId, ctx.businessId);
    await recordAuditEvent({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: 'SHIFT_DELETED',
      metadata: {
        shiftId: id,
        clientId: existing.clientId,
        cancelledTotalAmount: existing.totalAmount ? existing.totalAmount.toString() : '0.00',
      },
    });
  }
  // idempotent: cancelling an already-cancelled shift is a no-op success

  return { shiftId: id, status: 'CANCELLED' };
}

/** Section 12.6 — GET /shifts/uninvoiced */
export async function getUninvoicedGrouped(ctx: ActorContext) {
  const where: Prisma.ShiftWhereInput = { businessId: ctx.businessId, status: 'PENDING' };
  if (ctx.role === 'TECHNICIAN') where.userId = ctx.userId;

  const shifts = await prisma.shift.findMany({
    where,
    include: SHIFT_INCLUDE,
    orderBy: [{ clientId: 'asc' }, { shiftDate: 'asc' }],
  });

  const byClient = new Map<string, typeof shifts>();
  for (const s of shifts) {
    const arr = byClient.get(s.clientId) ?? [];
    arr.push(s);
    byClient.set(s.clientId, arr);
  }

  const groups = [...byClient.entries()].map(([clientId, clientShifts]) => {
    const totalHours = clientShifts.reduce(
      (acc, s) => acc + s.lineItems.filter((l) => l.unit === 'Hour').reduce((a, l) => a + Number(l.quantity), 0),
      0,
    );
    const totalTravelKms = clientShifts.reduce((acc, s) => acc + (s.travelKms ? Number(s.travelKms) : 0), 0);
    const totalAmount = clientShifts.reduce((acc, s) => acc + (s.totalAmount ? Number(s.totalAmount) : 0), 0);
    return {
      clientId,
      clientName: clientShifts[0].client.participantName,
      ndisNumber: clientShifts[0].client.ndisNumber,
      planManagementType: clientShifts[0].client.planManagementType,
      shiftCount: clientShifts.length,
      totalHours: Number(totalHours.toFixed(2)),
      totalTravelKms: Number(totalTravelKms.toFixed(2)),
      totalAmount: Number(totalAmount.toFixed(2)),
      shifts: clientShifts.map((s) => toShiftView(s as any)),
    };
  });

  return {
    groups,
    grandTotal: Number(groups.reduce((a, g) => a + g.totalAmount, 0).toFixed(2)),
    totalShifts: shifts.length,
  };
}
