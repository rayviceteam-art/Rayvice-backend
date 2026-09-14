import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { DateTime } from 'luxon';

process.env.DATABASE_URL = readFileSync('/tmp/.dburl', 'utf8').trim();

const prisma = new PrismaClient({ log: ['error'] });

const businessId = 'dde0c2cc-6f35-41ac-830c-7e1446367e06';
const tz = 'Australia/Sydney';
const now = DateTime.now().setZone(tz);
const monday = now.startOf('week');
const sunday = monday.plus({ days: 6 }).endOf('day');
const start = monday.toISODate()!;
const end = sunday.toISODate()!;
console.log('weekWindow:', start, end);

const shiftScope = { businessId };

async function run(label: string, fn: () => Promise<any>) {
  try {
    const r = await fn();
    console.log('OK:', label, JSON.stringify(r).slice(0, 200));
  } catch (e: any) {
    console.log('ERR:', label, e?.constructor?.name, e?.message?.slice(0, 300));
    console.log(e?.stack?.split('\n').slice(1, 6).join('\n'));
  }
}

await run('shift.aggregate', () =>
  prisma.shift.aggregate({
    where: { ...shiftScope, status: { not: 'CANCELLED' }, shiftDate: { gte: start, lte: end } },
    _sum: { totalAmount: true },
    _count: true,
  })
);

await run('client.count', () =>
  prisma.client.count({
    where: { businessId, isActive: true, deletedAt: null },
  })
);

await run('client.findMany(budget)', () =>
  prisma.client.findMany({
    where: { businessId, isActive: true, deletedAt: null, allocatedBudgetTotal: { not: null } },
  })
);

await run('shiftLineItem.aggregate-nested', () =>
  prisma.shiftLineItem.aggregate({
    where: {
      businessId,
      unit: 'Hour',
      shift: { ...shiftScope, status: { not: 'CANCELLED' }, shiftDate: { gte: start, lte: end } },
    },
    _sum: { quantity: true },
  })
);

await run('shift.findMany-includes', () =>
  prisma.shift.findMany({
    where: shiftScope,
    include: { client: true, lineItems: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })
);

await prisma.$disconnect();
