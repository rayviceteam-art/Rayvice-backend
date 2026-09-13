import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createShiftSchema, updateShiftSchema, assertShiftDateInWindow } from '../src/shifts/shift.validators';

const TZ = 'Australia/Sydney';

describe('createShiftSchema', () => {
  const base = {
    clientId: '11111111-1111-1111-1111-111111111111',
    shiftDate: '2026-08-25',
    startTime: '09:00',
    endTime: '11:00',
  };

  test('accepts a minimal valid payload', () => {
    assert.strictEqual(createShiftSchema.safeParse(base).success, true);
  });

  test('rejects bad time format', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, startTime: '9:00' }).success, false);
  });

  test('rejects malformed date', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, shiftDate: '25-08-2026' }).success, false);
  });

  test('rejects travelKms above 500', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, travelKms: 501 }).success, false);
  });

  test('rejects travelKms with more than 2 decimals', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, travelKms: 12.345 }).success, false);
  });

  test('accepts travelKms with exactly 2 decimals', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, travelKms: 12.5 }).success, true);
  });

  test('rejects caseNotes over 2000 chars', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, caseNotes: 'x'.repeat(2001) }).success, false);
  });

  test('accepts isPublicHoliday true/false/null', () => {
    assert.strictEqual(createShiftSchema.safeParse({ ...base, isPublicHoliday: true }).success, true);
    assert.strictEqual(createShiftSchema.safeParse({ ...base, isPublicHoliday: false }).success, true);
    assert.strictEqual(createShiftSchema.safeParse({ ...base, isPublicHoliday: null }).success, true);
  });
});

describe('updateShiftSchema', () => {
  test('rejects unknown / immutable fields (clientId, id, userId)', () => {
    assert.strictEqual(updateShiftSchema.safeParse({ clientId: '11111111-1111-1111-1111-111111111111' }).success, false);
    assert.strictEqual(updateShiftSchema.safeParse({ id: 'x' }).success, false);
  });

  test('accepts a partial edit of editable fields', () => {
    assert.strictEqual(updateShiftSchema.safeParse({ travelKms: 5 }).success, true);
  });
});

describe('assertShiftDateInWindow', () => {
  const today = DateTime.now().setZone(TZ).startOf('day');

  test('accepts today', () => {
    assert.doesNotThrow(() => assertShiftDateInWindow(today.toISODate()!, TZ));
  });

  test('accepts exactly 90 days back', () => {
    const d = today.minus({ days: 90 }).toISODate()!;
    assert.doesNotThrow(() => assertShiftDateInWindow(d, TZ));
  });

  test('rejects 91 days back (SHIFT_DATE_TOO_OLD)', () => {
    const d = today.minus({ days: 91 }).toISODate()!;
    try {
      assertShiftDateInWindow(d, TZ);
      assert.fail('expected throw');
    } catch (e: any) {
      assert.strictEqual(e.errorCode, 'SHIFT_DATE_TOO_OLD');
    }
  });

  test('rejects a future date (SHIFT_DATE_IN_FUTURE)', () => {
    const d = today.plus({ days: 1 }).toISODate()!;
    try {
      assertShiftDateInWindow(d, TZ);
      assert.fail('expected throw');
    } catch (e: any) {
      assert.strictEqual(e.errorCode, 'SHIFT_DATE_IN_FUTURE');
    }
  });
});
