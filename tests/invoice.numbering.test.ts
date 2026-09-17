import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatInvoiceNumber } from '../src/invoices/invoice.numbering';

describe('invoice.numbering — formatInvoiceNumber', () => {
  it('formats sequence 1 as INV-2026-0001', () => {
    assert.equal(formatInvoiceNumber('INV', 2026, 1), 'INV-2026-0001');
  });

  it('formats sequence 42 as INV-2026-0042', () => {
    assert.equal(formatInvoiceNumber('INV', 2026, 42), 'INV-2026-0042');
  });

  it('rolls over correctly across years with independent sequences', () => {
    assert.equal(formatInvoiceNumber('INV', 2026, 999), 'INV-2026-0999');
    assert.equal(formatInvoiceNumber('INV', 2027, 1), 'INV-2027-0001');
  });

  it('respects a custom invoice prefix', () => {
    assert.equal(formatInvoiceNumber('SOLE', 2026, 5), 'SOLE-2026-0005');
  });

  it('pads sequence numbers beyond 4 digits without truncation', () => {
    assert.equal(formatInvoiceNumber('INV', 2026, 12345), 'INV-2026-12345');
  });
});
