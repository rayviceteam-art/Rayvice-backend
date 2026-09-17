import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';

/**
 * Formats an invoice number: "INV-2026-0042".
 * Pure — no I/O. Unit-tested directly (tests/invoice.numbering.test.ts).
 */
export function formatInvoiceNumber(prefix: string, year: number, sequenceNumber: number): string {
  return `${prefix}-${year}-${String(sequenceNumber).padStart(4, '0')}`;
}

/**
 * Atomically allocates the next invoice number for (businessId, year) inside
 * the caller's transaction. Never derives the next number from count()/max()
 * outside a transaction (spec 2.3.2).
 *
 * Must be called with a transactional Prisma client (`tx`).
 */
export async function allocateInvoiceNumber(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  businessId: string,
  year: number,
  invoicePrefix: string
): Promise<{ invoiceYear: number; sequenceNumber: number; invoiceNumber: string }> {
  try {
    // Ensure the (businessId, year) row exists.
    await tx.invoiceSequence.upsert({
      where: { businessId_year: { businessId, year } },
      create: { businessId, year, lastNumber: 0 },
      update: {},
    });

    // Atomic increment-and-read.
    const updated = await tx.invoiceSequence.update({
      where: { businessId_year: { businessId, year } },
      data: { lastNumber: { increment: 1 } },
    });

    const sequenceNumber = updated.lastNumber;
    return {
      invoiceYear: year,
      sequenceNumber,
      invoiceNumber: formatInvoiceNumber(invoicePrefix, year, sequenceNumber),
    };
  } catch (error) {
    throw ApiError.conflict(
      'Failed to allocate a unique invoice number. Please retry.',
      'INVOICE_NUMBER_CONFLICT'
    );
  }
}
