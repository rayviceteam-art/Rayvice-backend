import { mock } from 'node:test';

const noopLogger: any = new Proxy({}, { get: () => (..._a: any[]) => {} });
mock.module('./src/config/logger', { namedExports: { logger: noopLogger }, defaultExport: noopLogger });

const { getDashboardSummary } = await import('./src/dashboard/dashboard.service');

try {
  const out: any = await getDashboardSummary({
    businessId: 'dde0c2cc-6f35-41ac-830c-7e1446367e06',
    userId: 'probe',
    role: 'OWNER',
  });
  console.log('OK', JSON.stringify(out).slice(0, 300));
} catch (e: any) {
  console.log('THREW:', e?.constructor?.name, (e?.message || '').slice(0, 600));
  console.log((e?.stack || '').split('\n').slice(1, 7).join('\n'));
}
