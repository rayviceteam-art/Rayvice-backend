import { sendEmail, isEmailConfigured } from '../utils/email.service';
import { InvoiceView } from './invoice.mapper';

export interface InvoiceDispatchInput {
  invoice: InvoiceView;
  to: string;
  bcc: string;
  pdfBuffer: Buffer;
  pdfFilename: string;
  businessName: string;
  bankSummary: { bankName: string | null; bsb: string | null; accountNumber: string | null } | null;
}

export type DispatchStatus = 'SENT' | 'SKIPPED_NDIA_MANAGED' | 'FAILED';

export interface DispatchResult {
  status: DispatchStatus;
  to: string | null;
  messageId: string | null;
  bcc: string | null;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function buildHtml(input: InvoiceDispatchInput): string {
  const { invoice, businessName, bankSummary } = input;
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;color:#0A0F10;">
    <h2 style="color:#16A085;">Tax Invoice ${invoice.invoiceNumber}</h2>
    <p>From <strong>${businessName}</strong></p>
    <p>Participant: <strong>${invoice.clientName ?? ''}</strong> (NDIS Number: ${invoice.ndisNumber ?? ''})</p>
    <p>Total Due: <strong>$${invoice.totalAmount.toFixed(2)}</strong> — Due ${fmtDate(invoice.dueDate)}</p>
    ${
      bankSummary
        ? `<p>Bank: ${bankSummary.bankName ?? ''} • BSB: ${bankSummary.bsb ?? ''} • Account: ${bankSummary.accountNumber ?? ''}</p>`
        : ''
    }
    <p style="color:#687572;font-size:12px;">NDIS Core Supports — GST Free per Section 38-38 of A New Tax System (GST) Act 1999</p>
    <p>The tax invoice is attached as a PDF.</p>
  </div>`;
}

function buildText(input: InvoiceDispatchInput): string {
  const { invoice, businessName, bankSummary } = input;
  const lines = [
    `Tax Invoice ${invoice.invoiceNumber}`,
    `From ${businessName}`,
    `Participant: ${invoice.clientName ?? ''} (NDIS Number: ${invoice.ndisNumber ?? ''})`,
    `Total Due: $${invoice.totalAmount.toFixed(2)} — Due ${fmtDate(invoice.dueDate)}`,
  ];
  if (bankSummary) {
    lines.push(`Bank: ${bankSummary.bankName ?? ''} • BSB: ${bankSummary.bsb ?? ''} • Account: ${bankSummary.accountNumber ?? ''}`);
  }
  lines.push('NDIS Core Supports — GST Free per Section 38-38 of A New Tax System (GST) Act 1999');
  lines.push('The tax invoice PDF is attached.');
  return lines.join('\n');
}

/**
 * Dispatches the invoice email. NDIA_MANAGED is never emailed (D5, spec 2.7.2).
 * Caller decides whether to call this at all based on planManagementType, but
 * this function is defensive and also skips NDIA_MANAGED itself.
 */
export async function dispatchInvoiceEmail(input: InvoiceDispatchInput): Promise<DispatchResult> {
  if (input.invoice.planManagementType === 'NDIA_MANAGED') {
    return { status: 'SKIPPED_NDIA_MANAGED', to: null, messageId: null, bcc: null };
  }

  if (!isEmailConfigured()) {
    return { status: 'FAILED', to: input.to, messageId: null, bcc: input.bcc };
  }

  try {
    const result = await sendEmail({
      to: input.to,
      bcc: input.bcc,
      subject: `Tax Invoice ${input.invoice.invoiceNumber} — ${input.invoice.clientName ?? ''} — ${fmtDate(
        input.invoice.issueDate
      )}`,
      html: buildHtml(input),
      text: buildText(input),
      attachments: [{ filename: input.pdfFilename, content: input.pdfBuffer }],
    });
    return { status: 'SENT', to: input.to, messageId: result.messageId, bcc: input.bcc };
  } catch {
    return { status: 'FAILED', to: input.to, messageId: null, bcc: input.bcc };
  }
}
