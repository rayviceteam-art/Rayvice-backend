/**
 * MODULE 4 — response mapper
 * src/shifts/shift.mapper.ts
 *
 * Section 21: builds the flat ShiftView the existing frontend expects.
 * Never rename these fields; extra data belongs in lineItems (21.3).
 */
import { Prisma } from '@prisma/client';

const num = (d: Prisma.Decimal | null | undefined): number => (d ? Number(d.toFixed(2)) : 0);

// Shape of what shift.service.ts loads via prisma (shift + client + lineItems).
export interface ShiftWithRelations {
  id: string;
  clientId: string;
  userId: string;
  client: { participantName: string; ndisNumber: string };
  shiftDate: Date | string;
  startTime: string;
  endTime: string;
  travelKms: Prisma.Decimal | null;
  supportItemCode: string;
  caseNotes: string | null;
  status: 'PENDING' | 'INVOICED' | 'CANCELLED';
  isInvoiced: boolean;
  isPublicHoliday: boolean;
  publicHolidayName: string | null;
  timezoneUsed: string | null;
  totalAmount: Prisma.Decimal | null;
  hourlyRateApplied: Prisma.Decimal | null;
  calculatedAt: Date | null;
  createdAt: Date;
  lineItems: Array<{
    rateTier: string;
    supportItemCode: string;
    description: string;
    quantity: Prisma.Decimal;
    unit: string;
    ndisCapRate: Prisma.Decimal;
    appliedRate: Prisma.Decimal;
    amount: Prisma.Decimal;
    segmentStart: Date | null;
    segmentEnd: Date | null;
    sortOrder: number;
  }>;
}

export function toShiftView(shift: ShiftWithRelations) {
  const dayLines = shift.lineItems.filter((l) => l.rateTier === 'DAY');
  const eveLines = shift.lineItems.filter((l) => l.rateTier === 'EVENING');
  const firstTimeLine = shift.lineItems.find((l) => l.unit === 'Hour');

  const dayHours = dayLines.reduce((a, l) => a + Number(l.quantity), 0);
  const dayTotal = dayLines.reduce((a, l) => a + Number(l.amount), 0);
  const eveHours = eveLines.reduce((a, l) => a + Number(l.quantity), 0);
  const eveTotal = eveLines.reduce((a, l) => a + Number(l.amount), 0);
  const travelLine = shift.lineItems.find((l) => l.rateTier === 'TRAVEL');

  const shiftDateStr =
    typeof shift.shiftDate === 'string' ? shift.shiftDate : shift.shiftDate.toISOString().slice(0, 10);

  return {
    id: shift.id,
    clientId: shift.clientId,
    userId: shift.userId, // §7.5 — the UI needs ownership for TECHNICIAN edit/cancel rules
    clientName: shift.client.participantName,
    ndisNumber: shift.client.ndisNumber, // Q4: TECHNICIAN sees full number, same as Module 3
    shiftDate: shiftDateStr,
    startTime: shift.startTime,
    endTime: shift.endTime,
    totalHours: Number((dayHours + eveHours + eveOtherHours(shift)).toFixed(2)),
    dayHours: Number(dayHours.toFixed(2)),
    eveHours: Number(eveHours.toFixed(2)),
    travelKms: num(shift.travelKms),
    hourlyRate: firstTimeLine ? Number(firstTimeLine.appliedRate) : null,
    dayTotal: Number(dayTotal.toFixed(2)),
    eveTotal: Number(eveTotal.toFixed(2)),
    travelTotal: travelLine ? Number(travelLine.amount) : 0,
    grandTotal: num(shift.totalAmount),
    supportItemCode: shift.supportItemCode,
    caseNotes: shift.caseNotes,
    status: shift.status,
    isInvoiced: shift.isInvoiced,
    isPublicHoliday: shift.isPublicHoliday,
    publicHolidayName: shift.publicHolidayName,
    timezone: shift.timezoneUsed,
    calculatedAt: shift.calculatedAt ? shift.calculatedAt.toISOString() : null,
    createdAt: shift.createdAt.toISOString(),
    lineItems: shift.lineItems
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        rateTier: l.rateTier,
        supportItemCode: l.supportItemCode,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        ndisCapRate: Number(l.ndisCapRate),
        appliedRate: Number(l.appliedRate),
        amount: Number(l.amount),
        segmentStart: l.segmentStart ? l.segmentStart.toISOString() : null,
        segmentEnd: l.segmentEnd ? l.segmentEnd.toISOString() : null,
        sortOrder: l.sortOrder,
      })),
  };
}

// totalHours must also include SATURDAY/SUNDAY/HOLIDAY hour-lines even though
// they aren't folded into dayHours/eveHours individually (Section 21.1 rule).
function eveOtherHours(shift: ShiftWithRelations): number {
  return shift.lineItems
    .filter((l) => l.unit === 'Hour' && l.rateTier !== 'DAY' && l.rateTier !== 'EVENING')
    .reduce((a, l) => a + Number(l.quantity), 0);
}

export function budgetBlock(spent: Prisma.Decimal, total: Prisma.Decimal | null) {
  const allocatedTotal = total ? Number(total.toFixed(2)) : 0;
  const allocatedSpent = Number(spent.toFixed(2));
  const utilizationPercent = allocatedTotal > 0 ? Number(((allocatedSpent / allocatedTotal) * 100).toFixed(2)) : 0;
  const level = !total || total.isZero() ? 'OK' : utilizationPercent >= 100 ? 'EXHAUSTED' : utilizationPercent >= 70 ? 'WARNING' : 'OK';
  return { allocatedTotal, allocatedSpent, utilizationPercent, level };
}
