/**
 * MODULE 4 — Deterministic NDIS Auto-Split Engine
 * src/shifts/shift.engine.ts
 *
 * Design constraints (Section 7.1):
 *  - Pure function: no DB access, no network, no Date.now() in the core walk.
 *  - Deterministic: same input -> same output, always.
 *  - Holiday facts and rates are injected as arguments (HolidayChecker,
 *    RateTable) so this file has zero I/O and is 100% unit-testable.
 *
 * NOTE ON Decimal: see shift.types.ts header — swap the decimal.js import
 * for Prisma.Decimal in the real repo; the API is identical.
 */
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import {
  ShiftCalculationInput,
  ShiftCalculationResult,
  RateTable,
  RateCell,
  CalculatedLine,
  HolidayChecker,
  RateTier,
  RateSource,
  ShiftEngineError,
} from './shift.types';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DURATION_MINUTES = 960; // 16 h — Section 5.6 / 7.3.5
const LONG_SHIFT_WARNING_MINUTES = 720; // 12 h
const MAX_TRAVEL_KM = 500;

function round2(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function fmtHM(dt: DateTime): string {
  return dt.toFormat('HH:mm');
}

function tierCell(rateTable: RateTable, tier: Exclude<RateTier, 'TRAVEL'>): RateCell {
  switch (tier) {
    case 'DAY':
      return rateTable.day;
    case 'EVENING':
      return rateTable.evening;
    case 'SATURDAY':
      return rateTable.saturday;
    case 'SUNDAY':
      return rateTable.sunday;
    case 'HOLIDAY':
      return rateTable.holiday;
  }
}

function assertCellPresent(cell: RateCell | undefined | null): asserts cell is RateCell {
  if (!cell || !cell.itemCode || cell.cap === undefined || cell.cap === null) {
    throw new ShiftEngineError(
      'SUPPORT_CATALOGUE_INCOMPLETE',
      'One or more required NDIS support items are missing from the catalogue',
    );
  }
}

const DESCRIPTION_TEMPLATES: Record<Exclude<RateTier, 'TRAVEL'>, string> = {
  DAY: 'Weekday Daytime Support',
  EVENING: 'Weekday Evening Support',
  SATURDAY: 'Saturday Support',
  SUNDAY: 'Sunday Support',
  HOLIDAY: 'Public Holiday Support',
};

interface WorkingLine {
  rateTier: RateTier;
  supportItemCode: string;
  quantity: Decimal;
  unit: 'Hour' | 'KM';
  ndisCapRate: Decimal;
  appliedRate: Decimal;
  amount: Decimal;
  segStart: DateTime | null;
  segEnd: DateTime | null;
}

export function calculateShift(
  input: ShiftCalculationInput,
  rateTable: RateTable,
  holidayChecker: HolidayChecker,
): ShiftCalculationResult {
  const warnings: string[] = [];

  // ---- Section 7.3 step 1 — format validation ----
  if (!DATE_RE.test(input.date)) {
    throw new ShiftEngineError('SHIFT_DATE_INVALID', `Invalid date: "${input.date}"`);
  }
  if (!TIME_RE.test(input.startTime) || !TIME_RE.test(input.endTime)) {
    throw new ShiftEngineError('SHIFT_TIME_FORMAT_INVALID', 'startTime/endTime must be 24-hour "HH:mm"');
  }
  if (input.startTime === input.endTime) {
    throw new ShiftEngineError('SHIFT_DURATION_INVALID', 'startTime and endTime cannot be equal');
  }

  // ---- catalogue completeness (thrown before any segment work) ----
  assertCellPresent(rateTable.day);
  assertCellPresent(rateTable.evening);
  assertCellPresent(rateTable.saturday);
  assertCellPresent(rateTable.sunday);
  assertCellPresent(rateTable.holiday);

  // ---- step 2/3 — build local start/end, overnight rollover ----
  const startLocal = DateTime.fromISO(`${input.date}T${input.startTime}`, { zone: input.timezone });
  if (!startLocal.isValid) {
    throw new ShiftEngineError('SHIFT_DATE_INVALID', startLocal.invalidReason || 'Invalid start date/time');
  }

  let endLocal = DateTime.fromISO(`${input.date}T${input.endTime}`, { zone: input.timezone });
  if (input.endTime <= input.startTime) {
    endLocal = endLocal.plus({ days: 1 });
  }
  if (!endLocal.isValid) {
    throw new ShiftEngineError('SHIFT_DATE_INVALID', endLocal.invalidReason || 'Invalid end date/time');
  }

  // ---- step 4 — duration (absolute elapsed time; DST-safe via luxon) ----
  const durationMinutes = endLocal.diff(startLocal, 'minutes').minutes;
  if (durationMinutes <= 0) {
    throw new ShiftEngineError('SHIFT_DURATION_INVALID', 'Non-positive shift duration');
  }

  // ---- step 5 — guard rails ----
  if (durationMinutes > MAX_DURATION_MINUTES) {
    throw new ShiftEngineError('SHIFT_DURATION_TOO_LONG', 'Shift duration exceeds 16 hours');
  }
  if (durationMinutes > LONG_SHIFT_WARNING_MINUTES) {
    warnings.push('LONG_SHIFT_WARNING');
  }

  // ---- step 6 — holiday resolution (per segment, manual override applies shift-wide) ----
  const override = input.isPublicHoliday; // true | false | null | undefined
  const overallHolidaySource: RateSource = override === true ? 'MANUAL' : override === false ? 'NOT_HOLIDAY' : 'AUTO';

  function resolveHoliday(localDayStart: DateTime): { isHoliday: boolean; name: string | null } {
    const iso = localDayStart.toISODate()!;
    if (override === true) {
      const fact = holidayChecker(iso);
      return { isHoliday: true, name: fact.name ?? 'Public Holiday' };
    }
    if (override === false) {
      return { isHoliday: false, name: null };
    }
    const fact = holidayChecker(iso);
    return { isHoliday: fact.isHoliday, name: fact.isHoliday ? fact.name : null };
  }

  // ---- step 7 — segment walk ----
  const working: WorkingLine[] = [];
  let cursor = startLocal;
  let anyHoliday = false;
  let firstHolidayName: string | null = null;

  while (cursor < endLocal) {
    const dayEnd = cursor.startOf('day').plus({ days: 1 });
    let next = endLocal < dayEnd ? endLocal : dayEnd;

    const dow = cursor.weekday; // luxon: 1 = Monday ... 7 = Sunday
    const isWeekday = dow >= 1 && dow <= 5;
    const local20 = cursor.startOf('day').set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

    if (isWeekday && cursor < local20 && next > local20) {
      // split first at the 20:00 evening boundary (7.3.c)
      next = local20;
    }

    const holidayInfo = resolveHoliday(cursor);
    if (holidayInfo.isHoliday) {
      anyHoliday = true;
      if (firstHolidayName === null) firstHolidayName = holidayInfo.name;
    }

    let tier: RateTier;
    if (holidayInfo.isHoliday) {
      tier = 'HOLIDAY';
    } else if (dow === 7) {
      tier = 'SUNDAY';
    } else if (dow === 6) {
      tier = 'SATURDAY';
    } else {
      // weekday: 00:00-06:00 and 06:00-20:00 both bill as DAY (decision D6);
      // only >= 20:00 local bills as EVENING.
      tier = cursor.hour >= 20 ? 'EVENING' : 'DAY';
    }

    const cell = tierCell(rateTable, tier as Exclude<RateTier, 'TRAVEL'>);
    const quantity = round2(new Decimal(next.diff(cursor, 'minutes').minutes).dividedBy(60));
    const appliedRate =
      rateTable.agreedRate === null ? cell.cap : Decimal.min(rateTable.agreedRate, cell.cap);
    const amount = round2(quantity.times(appliedRate));

    working.push({
      rateTier: tier,
      supportItemCode: cell.itemCode,
      quantity,
      unit: 'Hour',
      ndisCapRate: cell.cap,
      appliedRate,
      amount,
      segStart: cursor,
      segEnd: next,
    });

    cursor = next;
  }

  // ---- step 7.f — merge rule: consecutive lines with same tier+item+rate ----
  const merged: WorkingLine[] = [];
  for (const line of working) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.rateTier === line.rateTier &&
      prev.supportItemCode === line.supportItemCode &&
      prev.appliedRate.equals(line.appliedRate)
    ) {
      prev.quantity = round2(prev.quantity.plus(line.quantity));
      prev.amount = round2(prev.amount.plus(line.amount));
      prev.segEnd = line.segEnd;
    } else {
      merged.push({ ...line });
    }
  }

  // ---- build CalculatedLine[] for time tiers, with description labels ----
  let sortOrder = 0;
  const finalLines: CalculatedLine[] = merged.map((line) => {
    const startLabel = fmtHM(line.segStart!);
    const crossesMidnight = line.segEnd!.hour === 0 && line.segEnd!.minute === 0 && line.segEnd!.toISODate() !== line.segStart!.toISODate();
    const endLabel = crossesMidnight ? '24:00' : fmtHM(line.segEnd!);
    const label = DESCRIPTION_TEMPLATES[line.rateTier as Exclude<RateTier, 'TRAVEL'>];

    return {
      rateTier: line.rateTier,
      supportItemCode: line.supportItemCode,
      description: `${label} (${startLabel} - ${endLabel})`,
      quantity: line.quantity,
      unit: 'Hour',
      ndisCapRate: line.ndisCapRate,
      appliedRate: line.appliedRate,
      amount: line.amount,
      segmentStart: line.segStart!.toUTC().toJSDate(),
      segmentEnd: line.segEnd!.toUTC().toJSDate(),
      sortOrder: sortOrder++,
    };
  });

  // ---- step 8 — travel ----
  let travelQty = new Decimal(0);
  if (input.travelKms !== undefined && input.travelKms !== null) {
    const km = input.travelKms;
    if (typeof km !== 'number' || Number.isNaN(km) || km < 0 || km > MAX_TRAVEL_KM) {
      throw new ShiftEngineError('TRAVEL_KM_INVALID', 'travelKms must be a number between 0 and 500');
    }
    if (km > 0) {
      if (!rateTable.travelAllowed) {
        throw new ShiftEngineError('TRAVEL_NOT_ALLOWED_FOR_ITEM', 'Travel is not allowed for this support item');
      }
      assertCellPresent(rateTable.travel);
      travelQty = round2(new Decimal(km));
      const rate = rateTable.travel.cap; // never the agreed rate (Section 4.5)
      const amount = round2(travelQty.times(rate));
      finalLines.push({
        rateTier: 'TRAVEL',
        supportItemCode: rateTable.travel.itemCode,
        description: `Activity-Based Transport (${travelQty.toString()} km @ $${rate.toFixed(2)}/km)`,
        quantity: travelQty,
        unit: 'KM',
        ndisCapRate: rate,
        appliedRate: rate,
        amount,
        segmentStart: null,
        segmentEnd: null,
        sortOrder: sortOrder++,
      });
    }
  }

  // ---- step 9/10 — totals ----
  const totalHours = round2(
    finalLines.filter((l) => l.unit === 'Hour').reduce((acc, l) => acc.plus(l.quantity), new Decimal(0)),
  );
  const grandTotal = finalLines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));

  return {
    lines: finalLines,
    totalHours,
    travelKms: travelQty,
    grandTotal,
    isPublicHoliday: anyHoliday,
    publicHolidayName: firstHolidayName,
    holidaySource: overallHolidaySource,
    startAt: startLocal.toUTC().toJSDate(),
    endAt: endLocal.toUTC().toJSDate(),
    timezoneUsed: input.timezone,
    warnings,
  };
}
