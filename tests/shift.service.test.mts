import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
/**
 * MODULE 4 — shift service tests (Section 15.1).
 * Overlap detection, duplicate detection, idempotency replay, invoiced
 * immutability and cancel idempotency — with a mocked data layer.
 * The calculation engine itself runs for real (pure + deterministic);
 * only I/O boundaries are mocked. No network, no database.
 *
 * NOTE (.mts): tsx compiles sibling .ts files to CJS with frozen export
 * namespaces, so in-place stubbing is impossible there. This file is ESM,
 * which allows mock.module() interception before the service loads.
 */
import { Prisma } from '@prisma/client';

const D = (v: string | number) => new Prisma.Decimal(v);

// ---------------------------------------------------------------------------
// Programmable Prisma double
// ---------------------------------------------------------------------------
interface StubState {
  shiftFindFirst: Array<unknown>;
  businessRow: any;
  clientRow: any;
  clientByIdRow: any;
  createdRow: any;
  txCalls: { create: number; update: number; deleteMany: number; createMany: number };
}

const stubState: StubState = {
  shiftFindFirst: [],
  businessRow: null,
  clientRow: null,
  clientByIdRow: null,
  createdRow: null,
  txCalls: { create: 0, update: 0, deleteMany: 0, createMany: 0 },
};

const prisma: any = {
  shift: {
    findFirst: async () => stubState.shiftFindFirst.shift() ?? null,
    findUnique: async () => null,
  },
  business: {
    findUniqueOrThrow: async () => stubState.businessRow,
  },
  client: {
    findFirst: async () => stubState.clientRow,
    findUniqueOrThrow: async () => stubState.clientByIdRow,
  },
  $transaction: async (cb: (tx: any) => Promise<any>) => {
    const tx: any = {
      shift: {
        create: async ({ data }: any) => {
          stubState.txCalls.create += 1;
          return { id: 'shift-new', ...data };
        },
        update: async () => {
          stubState.txCalls.update += 1;
          return {};
        },
        findUniqueOrThrow: async () => stubState.createdRow,
      },
      shiftLineItem: {
        createMany: async () => {
          stubState.txCalls.createMany += 1;
          return { count: 1 };
        },
        deleteMany: async () => {
          stubState.txCalls.deleteMany += 1;
          return { count: 1 };
        },
      },
    };
    return cb(tx);
  },
};

const recordAuditEvent = mock.fn(async () => {});
const recalculateClientBudgetSpent = mock.fn(async () => D(0));

const TEST_RATES = {
  day: { itemCode: '01_011_0107_1_1', cap: D(67.56) },
  evening: { itemCode: '01_015_0107_1_1', cap: D(74.42) },
  saturday: { itemCode: '01_014_0107_1_1', cap: D(95.07) },
  sunday: { itemCode: '01_013_0107_1_1', cap: D(122.59) },
  holiday: { itemCode: '01_012_0107_1_1', cap: D(150.12) },
  travel: { itemCode: '01_799_0107_1_1', cap: D(0.97), unit: 'KM' as const },
  agreedRate: null,
  travelAllowed: true,
};

mock.module('../src/config/database', { namedExports: { prisma } });
mock.module('../src/business/trial.util', {
  namedExports: {
    assertCanMutate: async () => {},
    checkTrialResourceLimit: async () => {},
  },
});
mock.module('../src/audit/audit.service', { namedExports: { recordAuditEvent } });
mock.module('../src/clients/client.service', { namedExports: { recalculateClientBudgetSpent } });
mock.module('../src/shifts/rateTable.loader', {
  namedExports: {
    loadRateTable: async () => TEST_RATES,
    resolveSupportItem: async () => ({ itemCode: '01_011_0107_1_1', travelAllowed: true }),
  },
});

const { createShift, updateShift, cancelShift } = await import('../src/shifts/shift.service');

const CTX = { businessId: 'biz-1', userId: 'user-1', role: 'OWNER' as const };

function resetState() {
  stubState.shiftFindFirst = [];
  stubState.businessRow = { id: 'biz-1', timezone: 'Australia/Sydney', state: 'NSW' };
  stubState.clientRow = {
    id: 'client-1',
    businessId: 'biz-1',
    isActive: true,
    deletedAt: null,
    defaultSupportItemCode: '01_011_0107_1_1',
    hourlyRateAgreed: null,
    allocatedBudgetTotal: D(15000),
  };
  stubState.clientByIdRow = { ...stubState.clientRow, allocatedBudgetSpent: D(0) };
  stubState.createdRow = null;
  stubState.txCalls = { create: 0, update: 0, deleteMany: 0, createMany: 0 };
  recordAuditEvent.mock.resetCalls();
  recalculateClientBudgetSpent.mock.resetCalls();
}

const BODY = {
  clientId: 'client-1',
  shiftDate: '2026-08-26', // Wednesday, not a holiday
  startTime: '09:00',
  endTime: '13:00',
};

function dayLineRow() {
  return {
    id: 'shift-new',
    clientId: 'client-1',
    userId: 'user-1',
    client: { participantName: 'Sarah Jenkins', ndisNumber: '430123456' },
    shiftDate: '2026-08-26',
    startTime: '09:00',
    endTime: '13:00',
    travelKms: D(0),
    supportItemCode: '01_011_0107_1_1',
    caseNotes: null,
    status: 'PENDING',
    isInvoiced: false,
    isPublicHoliday: false,
    publicHolidayName: null,
    timezoneUsed: 'Australia/Sydney',
    totalAmount: D('270.24'),
    hourlyRateApplied: D('67.56'),
    calculatedAt: new Date('2026-08-26T09:12:00.000Z'),
    createdAt: new Date('2026-08-26T09:12:00.000Z'),
    lineItems: [
      {
        rateTier: 'DAY',
        supportItemCode: '01_011_0107_1_1',
        description: 'Weekday Daytime Support (09:00 - 13:00)',
        quantity: D(4),
        unit: 'Hour',
        ndisCapRate: D('67.56'),
        appliedRate: D('67.56'),
        amount: D('270.24'),
        segmentStart: new Date('2026-08-25T23:00:00.000Z'),
        segmentEnd: new Date('2026-08-26T03:00:00.000Z'),
        sortOrder: 0,
      },
    ],
  };
}

async function assertErrorCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err: any) {
    assert.strictEqual(err?.errorCode, code);
    return;
  }
  assert.fail(`expected error ${code} but the call succeeded`);
}

describe('shift.service (mocked data layer, Section 15.1)', () => {
  beforeEach(() => resetState());

  it('rejects an overlapping shift with SHIFT_OVERLAP', async () => {
    stubState.shiftFindFirst = [{ id: 'shift-clash' }];
    await assertErrorCode(createShift(CTX, { ...BODY }, undefined), 'SHIFT_OVERLAP');
    assert.strictEqual(stubState.txCalls.create, 0);
  });

  it('rejects a duplicate shift with DUPLICATE_SHIFT', async () => {
    stubState.shiftFindFirst = [null, { id: 'shift-dup' }];
    await assertErrorCode(createShift(CTX, { ...BODY }, undefined), 'DUPLICATE_SHIFT');
    assert.strictEqual(stubState.txCalls.create, 0);
  });

  it('replays the original shift on idempotency-key reuse without creating', async () => {
    stubState.shiftFindFirst = [dayLineRow()]; // idempotency lookup hits
    const res: any = await createShift(CTX, { ...BODY }, 'key-123');
    assert.strictEqual(res.shift.id, 'shift-new');
    assert.strictEqual(res.idempotentReplay, true);
    assert.strictEqual(stubState.txCalls.create, 0);
  });

  it('creates a shift on the happy path with server-computed totals', async () => {
    stubState.shiftFindFirst = [null, null]; // no overlap, no duplicate
    stubState.createdRow = dayLineRow();
    const res: any = await createShift(CTX, { ...BODY }, 'key-abc');
    assert.strictEqual(res.shift.grandTotal, 270.24);
    assert.strictEqual(res.shift.lineItems.length, 1);
    assert.strictEqual(res.shift.lineItems[0].rateTier, 'DAY');
    assert.strictEqual(stubState.txCalls.create, 1);
    assert.strictEqual(stubState.txCalls.createMany, 1);
    assert.strictEqual(recalculateClientBudgetSpent.mock.callCount(), 1);
    assert.strictEqual(recordAuditEvent.mock.callCount(), 1);
    assert.strictEqual((recordAuditEvent.mock.calls[0].arguments[0] as any).action, 'SHIFT_LOGGED');
  });

  it('refuses to edit an invoiced shift with SHIFT_ALREADY_INVOICED', async () => {
    stubState.shiftFindFirst = [
      { id: 's-1', userId: 'user-1', status: 'INVOICED', isInvoiced: true, clientId: 'client-1' },
    ];
    await assertErrorCode(updateShift(CTX, 's-1', { caseNotes: 'x' }), 'SHIFT_ALREADY_INVOICED');
    assert.strictEqual(stubState.txCalls.update, 0);
  });

  it('refuses to edit a cancelled shift with SHIFT_CANCELLED', async () => {
    stubState.shiftFindFirst = [
      { id: 's-1', userId: 'user-1', status: 'CANCELLED', isInvoiced: false, clientId: 'client-1' },
    ];
    await assertErrorCode(updateShift(CTX, 's-1', { caseNotes: 'x' }), 'SHIFT_CANCELLED');
  });

  it('cancel is idempotent: already-cancelled resolves with no duplicate audit', async () => {
    stubState.shiftFindFirst = [
      {
        id: 's-1',
        userId: 'user-1',
        status: 'CANCELLED',
        isInvoiced: false,
        clientId: 'client-1',
        totalAmount: D('100.00'),
      },
    ];
    await cancelShift(CTX, 's-1');
    assert.strictEqual(stubState.txCalls.update, 0);
    assert.strictEqual(recordAuditEvent.mock.callCount(), 0);
  });
});
