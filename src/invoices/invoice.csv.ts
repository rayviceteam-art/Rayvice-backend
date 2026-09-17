/**
 * PRODA / Myplace CSV export — spec §2.9. Pure formatting functions,
 * unit-tested directly (tests/invoice.csv.test.ts). No DB access here;
 * the caller loads rows and passes them in.
 */

export interface ProdaCsvRow {
  registrationNumber: string; // Business.abn
  participantNdisNumber: string;
  participantName: string;
  serviceDate: string; // YYYY-MM-DD
  supportItemNumber: string;
  supportItemName: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  invoiceNumber: string;
}

const HEADER = [
  'Registration Number',
  'Participant NDIS Number',
  'Participant Name',
  'Service Date',
  'Support Item Number',
  'Support Item Name',
  'Quantity',
  'Unit',
  'Rate',
  'Amount',
  'Invoice Number',
];

/** RFC-4180 field escaping: quote if it contains a comma, quote, or newline. */
export function escapeCsvField(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatMoney(n: number): string {
  return n.toFixed(2);
}

/**
 * Builds the full CSV body (header + rows), CRLF line endings, ordered by
 * service date ascending, then invoice number, then original line order.
 */
export function buildProdaCsv(rows: ProdaCsvRow[]): string {
  const sorted = [...rows].sort((a, b) => {
    if (a.serviceDate !== b.serviceDate) return a.serviceDate < b.serviceDate ? -1 : 1;
    if (a.invoiceNumber !== b.invoiceNumber) return a.invoiceNumber < b.invoiceNumber ? -1 : 1;
    return 0;
  });

  const lines: string[] = [HEADER.map(escapeCsvField).join(',')];

  for (const row of sorted) {
    lines.push(
      [
        escapeCsvField(row.registrationNumber),
        escapeCsvField(row.participantNdisNumber),
        escapeCsvField(row.participantName),
        escapeCsvField(row.serviceDate),
        escapeCsvField(row.supportItemNumber),
        escapeCsvField(row.supportItemName),
        escapeCsvField(row.quantity.toFixed(2)),
        escapeCsvField(row.unit),
        escapeCsvField(formatMoney(row.rate)),
        escapeCsvField(formatMoney(row.amount)),
        escapeCsvField(row.invoiceNumber),
      ].join(',')
    );
  }

  return lines.join('\r\n') + '\r\n';
}

export function prodaCsvFilename(from: string, to: string): string {
  return `proda-claims-${from}-${to}.csv`;
}
