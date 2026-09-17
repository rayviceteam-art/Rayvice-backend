import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInvoiceTotals, round2 } from '../src/invoices/invoice.totals';

describe('invoice.totals — calculateInvoiceTotals', () => {
  it('sums multiple already-rounded lines correctly', () => {
    const totals = calculateInvoiceTotals([{ amount: 135.12 }, { amount: 67.56 }, { amount: 12.34 }]);
    assert.equal(totals.subtotalAmount, 215.02);
  });

  it('GST is always 0.00 regardless of business GST registration', () => {
    const totals = calculateInvoiceTotals([{ amount: 100 }]);
    assert.equal(totals.gstAmount, 0);
  });

  it('totalAmount always equals subtotalAmount (GST-free)', () => {
    const totals = calculateInvoiceTotals([{ amount: 258.39 }]);
    assert.equal(totals.totalAmount, totals.subtotalAmount);
  });

  it('handles an empty line list as zero', () => {
    const totals = calculateInvoiceTotals([]);
    assert.equal(totals.subtotalAmount, 0);
    assert.equal(totals.totalAmount, 0);
  });

  it('round2 rounds to exactly 2 decimal places', () => {
    assert.equal(round2(10.1), 10.1);
    assert.equal(round2(10.999), 11);
    assert.equal(round2(67.565), Number((67.565).toFixed(2)));
  });
});
