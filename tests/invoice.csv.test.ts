import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProdaCsv, escapeCsvField, prodaCsvFilename, ProdaCsvRow } from '../src/invoices/invoice.csv';

function row(overrides: Partial<ProdaCsvRow> = {}): ProdaCsvRow {
  return {
    registrationNumber: '51824753556',
    participantNdisNumber: '430123456',
    participantName: 'Sarah Jenkins',
    serviceDate: '2026-09-09',
    supportItemNumber: '01_011_0107_1_1',
    supportItemName: 'Weekday Daytime Support',
    quantity: 2,
    unit: 'Hour',
    rate: 67.56,
    amount: 135.12,
    invoiceNumber: 'INV-2026-0001',
    ...overrides,
  };
}

describe('invoice.csv — escaping (RFC 4180)', () => {
  it('leaves plain fields unquoted', () => {
    assert.equal(escapeCsvField('Sarah Jenkins'), 'Sarah Jenkins');
  });

  it('quotes fields containing a comma', () => {
    assert.equal(escapeCsvField('Jenkins, Sarah'), '"Jenkins, Sarah"');
  });

  it('doubles inner quotes', () => {
    assert.equal(escapeCsvField('She said "hi"'), '"She said ""hi"""');
  });

  it('quotes fields containing a newline', () => {
    assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
  });
});

describe('invoice.csv — header row', () => {
  it('matches the exact documented order', () => {
    const csv = buildProdaCsv([row()]);
    const headerLine = csv.split('\r\n')[0];
    assert.equal(
      headerLine,
      'Registration Number,Participant NDIS Number,Participant Name,Service Date,Support Item Number,Support Item Name,Quantity,Unit,Rate,Amount,Invoice Number'
    );
  });
});

describe('invoice.csv — comma-containing participant names', () => {
  it('quotes the participant name field', () => {
    const csv = buildProdaCsv([row({ participantName: 'Jenkins, Sarah' })]);
    assert.ok(csv.includes('"Jenkins, Sarah"'));
  });
});

describe('invoice.csv — ordering', () => {
  it('orders by service date ascending, then invoice number', () => {
    const rows = [
      row({ serviceDate: '2026-09-10', invoiceNumber: 'INV-2026-0002' }),
      row({ serviceDate: '2026-09-09', invoiceNumber: 'INV-2026-0003' }),
      row({ serviceDate: '2026-09-09', invoiceNumber: 'INV-2026-0001' }),
    ];
    const csv = buildProdaCsv(rows);
    const lines = csv.trim().split('\r\n').slice(1);
    assert.ok(lines[0].includes('2026-09-09') && lines[0].includes('INV-2026-0001'));
    assert.ok(lines[1].includes('2026-09-09') && lines[1].includes('INV-2026-0003'));
    assert.ok(lines[2].includes('2026-09-10') && lines[2].includes('INV-2026-0002'));
  });
});

describe('invoice.csv — 2dp money formatting', () => {
  it('formats rate and amount with exactly 2 decimals, no currency symbol', () => {
    const csv = buildProdaCsv([row({ rate: 67.5, amount: 135 })]);
    const dataLine = csv.trim().split('\r\n')[1];
    assert.ok(dataLine.includes(',67.50,'));
    assert.ok(dataLine.includes(',135.00,'));
  });
});

describe('invoice.csv — filename', () => {
  it('builds the documented filename shape', () => {
    assert.equal(prodaCsvFilename('2026-09-01', '2026-09-30'), 'proda-claims-2026-09-01-2026-09-30.csv');
  });
});
