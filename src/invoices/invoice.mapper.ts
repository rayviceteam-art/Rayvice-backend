import { Invoice, InvoiceLineItem } from '@prisma/client';

function toDateOnly(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

function toNumber(d: unknown): number {
  if (d === null || d === undefined) return 0;
  return Number(d);
}

type InvoiceWithLines = Invoice & {
  lineItems: InvoiceLineItem[];
  client?: { participantName: string } | null;
};

/**
 * Maps a stored Invoice (+ lineItems) to the exact InvoiceView contract
 * (spec §2.11). Money and quantities are numbers; dates are YYYY-MM-DD;
 * timestamps are ISO-8601 UTC strings. Field names are never renamed.
 */
export function toInvoiceView(invoice: InvoiceWithLines) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    clientId: invoice.clientId,
    clientName: invoice.client?.participantName ?? null,
    ndisNumber: invoice.participantNdisNumber,
    planManagementType: invoice.planManagementType,
    planManagerAgencyName: invoice.planManagerAgencyName,
    // Not stored as a separate column; PLAN_MANAGED recipientEmail IS the agency claims email.
    planManagerEmail: invoice.planManagementType === 'PLAN_MANAGED' ? invoice.recipientEmail : null,
    recipientEmail: invoice.recipientEmail,
    issueDate: toDateOnly(invoice.issueDate),
    dueDate: toDateOnly(invoice.dueDate),
    subtotalAmount: toNumber(invoice.subtotalAmount),
    gstAmount: toNumber(invoice.gstAmount),
    totalAmount: toNumber(invoice.totalAmount),
    status: invoice.status,
    shiftCount: invoice.lineItems.length,
    sentAt: invoice.sentAt ? invoice.sentAt.toISOString() : null,
    paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
    cancelledAt: invoice.cancelledAt ? invoice.cancelledAt.toISOString() : null,
    rejectionReason: invoice.rejectionReason,
    notes: invoice.notes ?? null,
    createdAt: invoice.createdAt.toISOString(),
    lineItems: invoice.lineItems.map((li) => ({
      serviceDate: toDateOnly(li.serviceDate),
      supportItemCode: li.supportItemCode,
      description: li.description,
      quantity: toNumber(li.quantity),
      unit: (li as unknown as { unit?: string }).unit ?? 'Hour',
      unitPrice: toNumber(li.unitPrice),
      totalAmount: toNumber(li.totalAmount),
    })),
  };
}

export type InvoiceView = ReturnType<typeof toInvoiceView>;
