import PDFDocument from 'pdfkit';

/**
 * PDF contract — spec §2.6. pdfkit only (no puppeteer/wkhtmltopdf).
 * Deterministic: identical input -> identical bytes (no timestamps other
 * than the invoice's own dates).
 */

export interface InvoicePdfLineItem {
  serviceDate: string; // YYYY-MM-DD
  supportItemCode: string;
  description: string;
  quantity: number;
  unit: string; // "Hour" | "KM"
  unitPrice: number;
  totalAmount: number;
}

export interface InvoicePdfInput {
  invoiceNumber: string;
  issueDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  businessName: string;
  businessAbn: string;
  businessEmail: string;
  businessPhone: string | null;
  businessAddress: string | null;
  participantName: string;
  participantNdisNumber: string;
  planManagementType: 'PLAN_MANAGED' | 'SELF_MANAGED' | 'NDIA_MANAGED';
  planManagerAgencyName: string | null;
  planManagerEmail: string | null;
  bankName: string | null;
  accountName: string | null;
  bsb: string | null;
  accountNumber: string | null;
  lineItems: InvoicePdfLineItem[];
  subtotalAmount: number;
  gstAmount: number;
  totalAmount: number;
  notes: string | null;
  budget: { allocated: number; spent: number } | null;
}

const BRAND_TEAL = '#16A085';
const BORDER = '#253130';
const MUTED = '#687572';

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

function planManagementLabel(t: InvoicePdfInput['planManagementType']): string {
  if (t === 'PLAN_MANAGED') return 'Plan-Managed';
  if (t === 'SELF_MANAGED') return 'Self-Managed';
  return 'NDIA-Managed';
}

export function invoicePdfFilename(invoice: { invoiceNumber: string }): string {
  return `${invoice.invoiceNumber}.pdf`;
}

export async function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true, info: { Title: input.invoiceNumber } });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.font('Helvetica');

      // ---------- Header ----------
      const headerTop = doc.y;
      doc.fontSize(16).font('Helvetica-Bold').fillColor('#000000').text(input.businessName, 40, headerTop);
      doc.fontSize(10).font('Helvetica').fillColor('#000000');
      doc.text(`ABN: ${input.businessAbn}`);
      doc.text(input.businessEmail);
      if (input.businessPhone) doc.text(input.businessPhone);
      if (input.businessAddress) doc.text(input.businessAddress);

      const rightX = 320;
      doc.fontSize(22).font('Helvetica-Bold').fillColor(BRAND_TEAL).text('TAX INVOICE', rightX, headerTop, {
        width: 235,
        align: 'right',
      });
      doc.fontSize(10).font('Helvetica').fillColor('#000000');
      doc.text(`Invoice No: ${input.invoiceNumber}`, rightX, doc.y, { width: 235, align: 'right' });
      doc.text(`Issue Date: ${fmtDate(input.issueDate)}`, rightX, doc.y, { width: 235, align: 'right' });
      doc.text(`Due Date: ${fmtDate(input.dueDate)}`, rightX, doc.y, { width: 235, align: 'right' });

      doc.moveDown(0.3);
      doc
        .rect(rightX, doc.y, 235, 20)
        .fillOpacity(0.1)
        .fillAndStroke('#0D332D', BORDER)
        .fillOpacity(1);
      doc.fillColor('#5EE0C1').fontSize(9).text('GST-free supply', rightX, doc.y - 15, { width: 235, align: 'center' });

      doc.moveDown(2);
      doc.fillColor('#000000');

      // ---------- Bill To block ----------
      doc.fontSize(11).font('Helvetica-Bold').text('Bill To', 40, doc.y + 10);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Participant: ${input.participantName}`);
      doc.text(`NDIS Number: ${input.participantNdisNumber}`);
      doc.text(`Plan Management: ${planManagementLabel(input.planManagementType)}`);

      // ---------- Payee block (PLAN_MANAGED only) ----------
      if (input.planManagementType === 'PLAN_MANAGED') {
        doc.moveDown(0.5);
        doc.fontSize(11).font('Helvetica-Bold').text('Payee');
        doc.fontSize(10).font('Helvetica');
        doc.text(`Plan Manager: ${input.planManagerAgencyName ?? ''}`);
        doc.text(`Claims Email: ${input.planManagerEmail ?? ''}`);
      }

      // ---------- Bank EFT block ----------
      doc.moveDown(0.5);
      const bankBoxTop = doc.y;
      doc.rect(40, bankBoxTop, 515, input.planManagementType === 'NDIA_MANAGED' ? 30 : 70).stroke(BORDER);
      doc.fontSize(10).font('Helvetica-Bold').text('Payment Details', 50, bankBoxTop + 8);
      doc.font('Helvetica');
      if (input.planManagementType === 'NDIA_MANAGED') {
        doc.text('Claim via PRODA Myplace portal — no payment is made by email.', 50, bankBoxTop + 22);
      } else {
        doc.text(`Bank: ${input.bankName ?? ''}`, 50, bankBoxTop + 24);
        doc.text(`Account Name: ${input.accountName ?? ''}`, 50, doc.y);
        doc.text(`BSB: ${input.bsb ?? ''}`, 50, doc.y);
        doc.text(`Account Number: ${input.accountNumber ?? ''}`, 50, doc.y);
      }
      doc.y = bankBoxTop + (input.planManagementType === 'NDIA_MANAGED' ? 30 : 70) + 15;

      // ---------- Line-item table ----------
      const tableTop = doc.y;
      const cols = [
        { label: 'Date', width: 65 },
        { label: 'NDIS Item', width: 100 },
        { label: 'Description', width: 150 },
        { label: 'Hours/KM', width: 65 },
        { label: 'Rate', width: 60 },
        { label: 'Amount', width: 75 },
      ];
      let x = 40;
      doc.fontSize(9).font('Helvetica-Bold');
      for (const col of cols) {
        doc.text(col.label, x, tableTop, { width: col.width, align: col.label === 'Amount' || col.label === 'Rate' ? 'right' : 'left' });
        x += col.width;
      }
      doc.moveTo(40, tableTop + 14).lineTo(555, tableTop + 14).stroke(BORDER);

      let rowY = tableTop + 20;
      doc.font('Helvetica').fontSize(9);
      input.lineItems.forEach((item, idx) => {
        if (rowY > 740) {
          doc.addPage();
          rowY = 40;
        }
        if (idx % 2 === 1) {
          doc.rect(40, rowY - 4, 515, 18).fillOpacity(0.05).fill(BORDER).fillOpacity(1);
        }
        doc.fillColor('#000000');
        const unitSuffix = item.unit.toLowerCase().startsWith('k') ? 'km' : 'h';
        let cx = 40;
        doc.text(fmtDate(item.serviceDate), cx, rowY, { width: cols[0].width });
        cx += cols[0].width;
        doc.text(item.supportItemCode, cx, rowY, { width: cols[1].width });
        cx += cols[1].width;
        doc.text(item.description, cx, rowY, { width: cols[2].width });
        cx += cols[2].width;
        doc.text(`${item.quantity}${unitSuffix}`, cx, rowY, { width: cols[3].width, align: 'right' });
        cx += cols[3].width;
        doc.text(fmtMoney(item.unitPrice), cx, rowY, { width: cols[4].width, align: 'right' });
        cx += cols[4].width;
        doc.text(fmtMoney(item.totalAmount), cx, rowY, { width: cols[5].width, align: 'right' });
        rowY += 18;
      });

      doc.y = rowY + 10;

      // ---------- Totals block ----------
      const totalsX = 355;
      doc.fontSize(10).font('Helvetica');
      doc.text('Subtotal', totalsX, doc.y, { width: 100 });
      doc.text(fmtMoney(input.subtotalAmount), totalsX + 100, doc.y - 12, { width: 100, align: 'right' });
      doc.text('GST (0.00 — GST-free)', totalsX, doc.y, { width: 100 });
      doc.text(fmtMoney(input.gstAmount), totalsX + 100, doc.y - 12, { width: 100, align: 'right' });
      doc.font('Helvetica-Bold').fontSize(12);
      doc.text('TOTAL DUE', totalsX, doc.y + 4, { width: 100 });
      doc.text(fmtMoney(input.totalAmount), totalsX + 100, doc.y - 15, { width: 100, align: 'right' });

      if (input.budget) {
        doc.font('Helvetica').fontSize(9).fillColor(MUTED);
        const pct = input.budget.allocated > 0 ? Math.round((input.budget.spent / input.budget.allocated) * 100) : 0;
        doc.text(
          `Budget: $${input.budget.spent.toFixed(2)} of $${input.budget.allocated.toFixed(2)} allocated (${pct}% used)`,
          40,
          doc.y + 10
        );
        doc.fillColor('#000000');
      }

      // ---------- Notes ----------
      if (input.notes) {
        doc.moveDown(1.5);
        doc.font('Helvetica-Bold').fontSize(10).text('Notes');
        doc.font('Helvetica').fontSize(9).text(input.notes, { width: 515 });
      }

      // ---------- Footer on every page ----------
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .fontSize(7)
          .fillColor(MUTED)
          .text(
            'NDIS Core Supports — GST Free per Section 38-38 of A New Tax System (GST) Act 1999',
            40,
            800,
            { width: 515, align: 'center' }
          );
        doc.text(
          `Page ${i - range.start + 1} of ${range.count}    •    Generated by Rayvice • rayvice.com`,
          40,
          812,
          { width: 515, align: 'center' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
