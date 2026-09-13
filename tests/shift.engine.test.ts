import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
/**
 * MODULE 4 — Engine test matrix (Section 7.6 / Section 15.1)
 * The highest-value test file in the module: every boundary here
 * corresponds directly to a real-money rounding or tier decision.
 * Assertions use Decimal `.toString()` per Section 15.2 (never floats).
 */
import { Prisma } from '@prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { calculateShift } from '../src/shifts/shift.engine';
import { RateTable, HolidayChecker, ShiftEngineError } from '../src/shifts/shift.types';

const D = (n: number | string) => new Decimal(n);

function baseRateTable(overrides: Partial<RateTable> = {}): RateTable {
  return {
    day: { itemCode: '01_011_0107_1_1', cap: D('67.56') },
    evening: { itemCode: '01_015_0107_1_1', cap: D('74.42') },
    saturday: { itemCode: '01_014_0107_1_1', cap: D('95.07') },
    sunday: { itemCode: '01_013_0107_1_1', cap: D('122.59') },
    holiday: { itemCode: '01_012_0107_1_1', cap: D('150.12') },
    travel: { itemCode: '01_799_0107_1_1', cap: D('0.97'), unit: 'KM' },
    agreedRate: null,
    travelAllowed: true,
    ...overrides,
  };
}

// Default checker: nothing is ever a holiday, unless a test overrides it.
const noHolidays: HolidayChecker = () => ({ isHoliday: false, name: null });

function holidayOn(dates: string[], name = 'Public Holiday'): HolidayChecker {
  return (iso) => (dates.includes(iso) ? { isHoliday: true, name } : { isHoliday: false, name: null });
}

const TZ = 'Australia/Sydney';

describe('shift.engine — 22 case matrix', () => {
  // 1. Weekday 09:00-13:00 -> 1 DAY line, 4.00h = 270.24
  test('1. pure daytime weekday, no travel', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '13:00', timezone: TZ }, // Tue
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'DAY');
    assert.strictEqual(r.lines[0].quantity.toString(), '4');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '270.24');
    assert.strictEqual(r.grandTotal.toFixed(2), '270.24');
  });

  // 2. Example A — weekday straddling 20:00 + travel
  test('2. weekday straddling 20:00 + 12km travel (Example A)', () => {
    const r = calculateShift(
      { date: '2026-08-26', startTime: '18:00', endTime: '21:30', travelKms: 12, timezone: TZ }, // Wed
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 3);
    const [day, eve, travel] = r.lines;
    assert.strictEqual(day.rateTier, 'DAY');
    assert.strictEqual(day.quantity.toString(), '2');
    assert.strictEqual(day.amount.toFixed(2), '135.12');
    assert.strictEqual(eve.rateTier, 'EVENING');
    assert.strictEqual(eve.quantity.toString(), '1.5');
    assert.strictEqual(eve.amount.toFixed(2), '111.63');
    assert.strictEqual(travel.rateTier, 'TRAVEL');
    assert.strictEqual(travel.amount.toFixed(2), '11.64');
    assert.strictEqual(r.grandTotal.toFixed(2), '258.39');
  });

  // 3. Weekday 20:00-22:00 -> single EVENING 2.00h
  test('3. shift starting exactly at 20:00 is 100% EVENING', () => {
    const r = calculateShift(
      { date: '2026-08-26', startTime: '20:00', endTime: '22:00', timezone: TZ },
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'EVENING');
    assert.strictEqual(r.lines[0].quantity.toString(), '2');
  });

  // 4. Weekday 19:59-20:01 -> DAY 0.02h + EVENING 0.02h boundary split
  test('4. 19:59-20:01 splits into DAY 0.02h + EVENING 0.02h', () => {
    const r = calculateShift(
      { date: '2026-08-26', startTime: '19:59', endTime: '20:01', timezone: TZ },
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].rateTier, 'DAY');
    assert.strictEqual(r.lines[0].quantity.toFixed(2), '0.02');
    assert.strictEqual(r.lines[1].rateTier, 'EVENING');
    assert.strictEqual(r.lines[1].quantity.toFixed(2), '0.02');
  });

  // 5. Saturday 10:00-14:30 -> single SATURDAY 4.50h (Example C)
  test('5. Saturday shift (Example C)', () => {
    const r = calculateShift(
      { date: '2026-08-29', startTime: '10:00', endTime: '14:30', timezone: TZ }, // Sat
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'SATURDAY');
    assert.strictEqual(r.lines[0].quantity.toString(), '4.5');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '427.82');
  });

  // 6. Sunday 08:00-12:00 -> single SUNDAY 4.00h (Example D)
  test('6. Sunday shift (Example D)', () => {
    const r = calculateShift(
      { date: '2026-08-30', startTime: '08:00', endTime: '12:00', timezone: TZ }, // Sun
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'SUNDAY');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '490.36');
  });

  // 7. Public holiday (auto) on a weekday -> single HOLIDAY line (Example E)
  test('7. auto-detected public holiday (Example E)', () => {
    const r = calculateShift(
      { date: '2026-12-25', startTime: '09:00', endTime: '12:00', timezone: TZ }, // Christmas, a Friday
      baseRateTable(),
      holidayOn(['2026-12-25'], 'Christmas Day'),
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'HOLIDAY');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '450.36');
    assert.strictEqual(r.isPublicHoliday, true);
    assert.strictEqual(r.publicHolidayName, 'Christmas Day');
    assert.strictEqual(r.holidaySource, 'AUTO');
  });

  // 8. Manual override = true on a normal weekday -> single HOLIDAY line
  test('8. manual isPublicHoliday=true override on a normal weekday', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', timezone: TZ, isPublicHoliday: true },
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'HOLIDAY');
    assert.strictEqual(r.holidaySource, 'MANUAL');
  });

  // 9. Manual override = false on an actual holiday -> normal weekday rate
  test('9. manual isPublicHoliday=false overrides an actual holiday', () => {
    const r = calculateShift(
      { date: '2026-12-25', startTime: '09:00', endTime: '11:00', timezone: TZ, isPublicHoliday: false },
      baseRateTable(),
      holidayOn(['2026-12-25'], 'Christmas Day'),
    );
    assert.strictEqual(r.lines.length, 1);
    assert.strictEqual(r.lines[0].rateTier, 'DAY'); // 25 Dec 2026 is a Friday -> weekday DAY tier
    assert.strictEqual(r.isPublicHoliday, false);
    assert.strictEqual(r.holidaySource, 'NOT_HOLIDAY');
  });

  // 10. Friday 22:00 -> Saturday 01:00 (Example F)
  test('10. overnight Friday->Saturday (Example F)', () => {
    const r = calculateShift(
      { date: '2026-08-28', startTime: '22:00', endTime: '01:00', timezone: TZ }, // Fri
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].rateTier, 'EVENING');
    assert.strictEqual(r.lines[0].quantity.toString(), '2');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '148.84');
    assert.strictEqual(r.lines[1].rateTier, 'SATURDAY');
    assert.strictEqual(r.lines[1].quantity.toString(), '1');
    assert.strictEqual(r.lines[1].amount.toFixed(2), '95.07');
    assert.strictEqual(r.grandTotal.toFixed(2), '243.91');
  });

  // 11. Thursday 23:00 -> Friday 02:00, Friday is a holiday (Example G)
  test('11. overnight into a public holiday (Example G)', () => {
    const r = calculateShift(
      { date: '2026-12-24', startTime: '23:00', endTime: '02:00', timezone: TZ }, // Thu -> Fri
      baseRateTable(),
      holidayOn(['2026-12-25'], 'Christmas Day'),
    );
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].rateTier, 'EVENING');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '74.42');
    assert.strictEqual(r.lines[1].rateTier, 'HOLIDAY');
    assert.strictEqual(r.lines[1].amount.toFixed(2), '300.24');
    assert.strictEqual(r.grandTotal.toFixed(2), '374.66');
  });

  // 12. Overnight spanning Saturday -> Sunday: one line per tier, no bad merge
  test('12. overnight Saturday->Sunday produces one line per tier', () => {
    const r = calculateShift(
      { date: '2026-08-29', startTime: '23:00', endTime: '02:00', timezone: TZ }, // Sat -> Sun
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].rateTier, 'SATURDAY');
    assert.strictEqual(r.lines[0].quantity.toString(), '1');
    assert.strictEqual(r.lines[1].rateTier, 'SUNDAY');
    assert.strictEqual(r.lines[1].quantity.toString(), '2');
  });

  // 13. Agreed rate 60 (< cap 67.56) -> applied 60.00 (Example H)
  test('13. agreed rate below cap is applied', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', timezone: TZ },
      baseRateTable({ agreedRate: D('60.00') }),
      noHolidays,
    );
    assert.strictEqual(r.lines[0].appliedRate.toString(), '60');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '120.00');
  });

  // 14. Agreed rate 80 (> cap 67.56) -> capped at 67.56 (Example I)
  test('14. agreed rate above cap is capped', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', timezone: TZ },
      baseRateTable({ agreedRate: D('80.00') }),
      noHolidays,
    );
    assert.strictEqual(r.lines[0].appliedRate.toFixed(2), '67.56');
    assert.strictEqual(r.lines[0].amount.toFixed(2), '135.12');
  });

  // 15. Travel always billed at the statutory km rate, never the agreed rate
  test('15. travel ignores the agreed rate', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', travelKms: 10, timezone: TZ },
      baseRateTable({ agreedRate: D('40.00') }),
      noHolidays,
    );
    const travel = r.lines.find((l) => l.rateTier === 'TRAVEL')!;
    assert.strictEqual(travel.appliedRate.toFixed(2), '0.97');
    assert.strictEqual(travel.amount.toFixed(2), '9.70');
  });

  // 16. travelAllowed = false + km > 0 -> throws
  test('16. throws TRAVEL_NOT_ALLOWED_FOR_ITEM when the item forbids travel', () => {
    assert.throws(
      () =>
        calculateShift(
          { date: '2026-08-25', startTime: '09:00', endTime: '11:00', travelKms: 5, timezone: TZ },
          baseRateTable({ travelAllowed: false }),
          noHolidays,
        ),
      ShiftEngineError,
    );
    try {
      calculateShift(
        { date: '2026-08-25', startTime: '09:00', endTime: '11:00', travelKms: 5, timezone: TZ },
        baseRateTable({ travelAllowed: false }),
        noHolidays,
      );
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'TRAVEL_NOT_ALLOWED_FOR_ITEM');
    }
  });

  // 17. 17h shift -> throws SHIFT_DURATION_TOO_LONG
  test('17. 17-hour shift throws SHIFT_DURATION_TOO_LONG', () => {
    try {
      calculateShift(
        { date: '2026-08-25', startTime: '06:00', endTime: '23:00', timezone: TZ },
        baseRateTable(),
        noHolidays,
      );
      assert.fail('expected throw');
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'SHIFT_DURATION_TOO_LONG');
    }
  });

  // 18. 13h shift -> succeeds with LONG_SHIFT_WARNING
  test('18. 13-hour shift succeeds with LONG_SHIFT_WARNING', () => {
    const r = calculateShift(
      { date: '2026-08-25', startTime: '06:00', endTime: '19:00', timezone: TZ },
      baseRateTable(),
      noHolidays,
    );
    assert.ok(r.warnings.includes('LONG_SHIFT_WARNING'), `expected to contain 'LONG_SHIFT_WARNING'`);
  });

  // 19. DST spring-forward NSW (clocks forward first Sunday of October) — 2026-10-04
  test('19. DST spring-forward: 01:00-04:00 is 2.00 real hours', () => {
    const r = calculateShift(
      { date: '2026-10-04', startTime: '01:00', endTime: '04:00', timezone: TZ }, // Sunday
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.totalHours.toString(), '2');
  });

  // 20. DST fall-back NSW (clocks back first Sunday of April) — 2026-04-05
  test('20. DST fall-back: 01:00-04:00 is 4.00 real hours', () => {
    const r = calculateShift(
      { date: '2026-04-05', startTime: '01:00', endTime: '04:00', timezone: TZ }, // Sunday
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r.totalHours.toString(), '4');
  });

  // 21. Missing catalogue row -> throws SUPPORT_CATALOGUE_INCOMPLETE
  test('21. missing catalogue row throws SUPPORT_CATALOGUE_INCOMPLETE', () => {
    const bad = baseRateTable();
    // @ts-expect-error simulate a missing seeded row
    bad.evening = undefined;
    try {
      calculateShift({ date: '2026-08-25', startTime: '09:00', endTime: '11:00', timezone: TZ }, bad, noHolidays);
      assert.fail('expected throw');
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'SUPPORT_CATALOGUE_INCOMPLETE');
    }
  });

  // 22. Travel 0 or omitted -> no TRAVEL line
  test('22. travelKms omitted or zero produces no TRAVEL line', () => {
    const r1 = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', timezone: TZ },
      baseRateTable(),
      noHolidays,
    );
    const r2 = calculateShift(
      { date: '2026-08-25', startTime: '09:00', endTime: '11:00', travelKms: 0, timezone: TZ },
      baseRateTable(),
      noHolidays,
    );
    assert.strictEqual(r1.lines.some((l) => l.rateTier === 'TRAVEL'), false);
    assert.strictEqual(r2.lines.some((l) => l.rateTier === 'TRAVEL'), false);
  });
});

describe('shift.engine — additional guards', () => {
  test('startTime === endTime throws SHIFT_DURATION_INVALID', () => {
    try {
      calculateShift({ date: '2026-08-25', startTime: '09:00', endTime: '09:00', timezone: TZ }, baseRateTable(), noHolidays);
      assert.fail('expected throw');
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'SHIFT_DURATION_INVALID');
    }
  });

  test('bad time format throws SHIFT_TIME_FORMAT_INVALID', () => {
    try {
      calculateShift({ date: '2026-08-25', startTime: '9:00', endTime: '11:00', timezone: TZ }, baseRateTable(), noHolidays);
      assert.fail('expected throw');
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'SHIFT_TIME_FORMAT_INVALID');
    }
  });

  test('travelKms > 500 throws TRAVEL_KM_INVALID', () => {
    try {
      calculateShift(
        { date: '2026-08-25', startTime: '09:00', endTime: '11:00', travelKms: 501, timezone: TZ },
        baseRateTable(),
        noHolidays,
      );
      assert.fail('expected throw');
    } catch (e) {
      assert.strictEqual((e as ShiftEngineError).code, 'TRAVEL_KM_INVALID');
    }
  });
});
