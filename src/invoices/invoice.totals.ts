/**
 * Pure money math for invoice generation. No Decimal here on purpose —
 * ShiftLineItem.amount is already rounded to 2 dp per line by Module 4;
 * we sum those already-rounded numbers, never recompute a rate.
 */

export interface TotalsLineInput {
  amount: number; // ShiftLineItem.amount, already rounded to 2 dp
}

export interface InvoiceTotals {
  subtotalAmount: number;
  gstAmount: number; // always 0 — NDIS core supports are GST-free (D3)
  totalAmount: number;
}

export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function calculateInvoiceTotals(lines: TotalsLineInput[]): InvoiceTotals {
  const subtotalAmount = round2(lines.reduce((sum, line) => sum + line.amount, 0));
  return {
    subtotalAmount,
    gstAmount: 0.0,
    totalAmount: subtotalAmount, // gstAmount is always 0.00 (D3)
  };
}
