import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { budgetBlock, toShiftView } from '../src/shifts/shift.mapper';

const dec = (v: string | number) => new Prisma.Decimal(v);

function shiftFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shift-1',
    clientId: 'client-1',
    client: { participantName: 'Sarah Jenkins', ndisNumber: '430123456' },
    shiftDate: new Date('2026-08-26T00:00:00.000Z'),
    startTime: '18:00',
    endTime: '21:30',
    travelKms: dec('12'),
    supportItemCode: '01_011_0107_1_1',
    caseNotes: null,
    status: 'PENDING' as const,
    isInvoiced: false,
    isPublicHoliday: false,
    publicHolidayName: null,
    timezoneUsed: 'Australia/Sydney',
    totalAmount: dec('258.39'),
    hourlyRateApplied: dec('67.56'),
    calculatedAt: new Date('2026-08-26T09:12:00.000Z'),
    createdAt: new Date('2026-08-26T09:12:00.000Z'),
    lineItems: [
      {
        rateTier: 'DAY',
        supportItemCode: '01_011_0107_1_1',
        description: 'Weekday Daytime Support (18:00 - 20:00)',
        quantity: dec('2.00'),
        unit: 'Hour',
        ndisCapRate: dec('67.56'),
        appliedRate: dec('67.56'),
        amount: dec('135.12'),
        segmentStart: new Date('2026-08-26T08:00:00.000Z'),
        segmentEnd: new Date('2026-08-26T10:00:00.000Z'),
        sortOrder: 0,
      },
      {
        rateTier: 'EVENING',
        supportItemCode: '01_015_0107_1_1',
        description: 'Weekday Evening Support (20:00 - 21:30)',
        quantity: dec('1.50'),
        unit: 'Hour',
        ndisCapRate: dec('74.42'),
        appliedRate: dec('74.42'),
        amount: dec('111.63'),
        segmentStart: new Date('2026-08-26T10:00:00.000Z'),
        segmentEnd: new Date('2026-08-26T11:30:00.000Z'),
        sortOrder: 1,
      },
      {
        rateTier: 'TRAVEL',
        supportItemCode: '01_799_0107_1_1',
        description: 'Activity-Based Transport (12 km @ $0.97/km)',
        quantity: dec('12.00'),
        unit: 'KM',
        ndisCapRate: dec('0.97'),
        appliedRate: dec('0.97'),
        amount: dec('11.64'),
        segmentStart: null,
        segmentEnd: null,
        sortOrder: 2,
      },
    ],
    ...overrides,
  };
}

describe('Module 4 — shift mapper (ShiftView contract, Section 21)', () => {
  it('maps the specification example A totals exactly', () => {
    const view = toShiftView(shiftFixture() as never);
    assert.strictEqual(view.dayHours, 2);
    assert.strictEqual(view.eveHours, 1.5);
    assert.strictEqual(view.dayTotal, 135.12);
    assert.strictEqual(view.eveTotal, 111.63);
    assert.strictEqual(view.travelTotal, 11.64);
    assert.strictEqual(view.grandTotal, 258.39);
    assert.strictEqual(view.totalHours, 3.5);
    assert.strictEqual(view.travelKms, 12);
    assert.strictEqual(view.hourlyRate, 67.56);
    assert.strictEqual(view.shiftDate, '2026-08-26');
    assert.strictEqual(view.clientName, 'Sarah Jenkins');
    assert.strictEqual(view.ndisNumber, '430123456');
    assert.strictEqual(view.status, 'PENDING');
    assert.strictEqual(view.lineItems.length, 3);
  });

  it('counts SATURDAY/SUNDAY/HOLIDAY hours in totalHours but not in dayHours', () => {
    const fixture = shiftFixture({
      lineItems: [
        {
          rateTier: 'SATURDAY',
          supportItemCode: '01_014_0107_1_1',
          description: 'Saturday Support (10:00 - 14:30)',
          quantity: dec('4.50'),
          unit: 'Hour',
          ndisCapRate: dec('95.07'),
          appliedRate: dec('95.07'),
          amount: dec('427.82'),
          segmentStart: null,
          segmentEnd: null,
          sortOrder: 0,
        },
      ],
    });
    const view = toShiftView(fixture as never);
    assert.strictEqual(view.dayHours, 0);
    assert.strictEqual(view.eveHours, 0);
    assert.strictEqual(view.totalHours, 4.5);
  });

  it('serialises money as numbers, never Decimal strings', () => {
    const view = toShiftView(shiftFixture() as never);
    assert.strictEqual(typeof view.grandTotal, 'number');
    assert.strictEqual(typeof view.lineItems[0].amount, 'number');
    assert.strictEqual(typeof view.lineItems[0].appliedRate, 'number');
  });

  it('sorts line items by sortOrder', () => {
    const fixture = shiftFixture();
    fixture.lineItems = [fixture.lineItems[2], fixture.lineItems[0], fixture.lineItems[1]];
    const view = toShiftView(fixture as never);
    assert.deepStrictEqual(
      view.lineItems.map((l) => l.sortOrder),
      [0, 1, 2]
    );
  });
});

describe('Module 4 — budget block (Section 9.3)', () => {
  it('reports OK below 70%', () => {
    const block = budgetBlock(dec('1000.00'), dec('15000.00'));
    assert.strictEqual(block.level, 'OK');
    assert.strictEqual(block.utilizationPercent, 6.67);
  });

  it('reports WARNING at 70% and above', () => {
    const block = budgetBlock(dec('10500.00'), dec('15000.00'));
    assert.strictEqual(block.level, 'WARNING');
    assert.strictEqual(block.utilizationPercent, 70);
  });

  it('reports EXHAUSTED at 100% and above', () => {
    const block = budgetBlock(dec('16000.00'), dec('15000.00'));
    assert.strictEqual(block.level, 'EXHAUSTED');
  });

  it('reports OK when no budget is configured', () => {
    const block = budgetBlock(dec('500.00'), null);
    assert.strictEqual(block.level, 'OK');
    assert.strictEqual(block.allocatedTotal, 0);
  });
});
