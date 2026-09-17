import { DateTime } from 'luxon';
import { Prisma, InvoiceStatus, PlanManagementType } from '@prisma/client';
import { prisma } from '../config/database';
import { ApiError } from '../utils/ApiError';
import { recordAuditEvent } from '../audit/audit.service';
import { assertCanMutate, checkTrialResourceLimit } from '../business/trial.util';
import { buildPaginationMeta, paginationSkip } from '../utils/pagination';
import { recalculateClientBudgetSpent } from '../clients/client.service';
import { validateInvoiceBeforeDispatch, ShieldInput, ShieldLineItem } from './invoice.shield';
import { allocateInvoiceNumber } from './invoice.numbering';
import { calculateInvoiceTotals } from './invoice.totals';
import { generateInvoicePdf, invoicePdfFilename, InvoicePdfInput } from './invoice.pdf';
import { dispatchInvoiceEmail } from './invoice.email';
import { isEmailConfigured } from '../utils/email.service';
import { toInvoiceView, InvoiceView } from './invoice.mapper';
import { buildProdaCsv, prodaCsvFilename, ProdaCsvRow } from './invoice.csv';
import { GenerateInvoiceInput, ListInvoicesQuery, ProdaExportQuery } from './invoice.validators';
import { env } from '../config/env';
import { logger } from '../config/logger';

export interface InvoiceContext {
  businessId: string;
  userId: string;
  ipAddress?: string;
  userAgent?: string;
}

const INVOICE_INCLUDE = {
  lineItems: { orderBy: { serviceDate: 'asc' as const } },
  client: { select: { participantName: true } },
};

// ---------------------------------------------------------------------------
// Plan gating (spec 2.8)
// ---------------------------------------------------------------------------

async function enforceInvoicePlanLimit(businessId: string): Promise<void> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { planTier: true, timezone: true, status: true, trialEndsAt: true },
  });
  if (!business) throw ApiError.notFound('Business not found.');

  if (business.planTier === 'TRIAL') {
    await checkTrialResourceLimit(businessId, 'invoices');
    return;
  }

  if (business.planTier === 'STARTER') {
    const tz = business.timezone || 'Australia/Sydney';
    const now = DateTime.now().setZone(tz);
    const monthStart = now.startOf('month').toJSDate();
    const monthEnd = now.endOf('month').toJSDate();
    const count = await prisma.invoice.count({
      where: { businessId, createdAt: { gte: monthStart, lte: monthEnd } },
    });
    if (count >= 20) {
      throw ApiError.forbidden(
        'Starter plan is limited to 20 invoices per calendar month. Upgrade to Pro for unlimited invoicing.',
        'STARTER_INVOICE_LIMIT_REACHED'
      );
    }
  }
  // PRO — unlimited
}

// ---------------------------------------------------------------------------
// Generate + dispatch (spec 2.5)
// ---------------------------------------------------------------------------

export async function generateInvoice(input: GenerateInvoiceInput, ctx: InvoiceContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  // 1 — trial/read-only gate
  await assertCanMutate(businessId);
  // 2 — plan/limit gate
  await enforceInvoicePlanLimit(businessId);

  // 3 — load business + client
  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw ApiError.notFound('Business not found.');

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, businessId, deletedAt: null },
  });
  if (!client) throw ApiError.notFound('Participant not found.', 'CLIENT_NOT_FOUND');
  if (!client.isActive) throw ApiError.unprocessable('This participant is inactive.', 'CLIENT_INACTIVE');

  // 4 — load selected shifts
  const shifts = await prisma.shift.findMany({
    where: {
      id: { in: input.shiftIds },
      businessId,
      clientId: input.clientId,
      status: 'PENDING',
      isInvoiced: false,
    },
  });

  const foundIds = new Set(shifts.map((s) => s.id));
  const missingIds = input.shiftIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    throw ApiError.conflict(
      'One or more selected shifts are not invoiceable (already invoiced, cancelled, or not found).',
      'SHIFT_NOT_INVOICEABLE',
      { shiftIds: missingIds }
    );
  }

  // 5 — line items + NDIS cap map
  const lineItems = await prisma.shiftLineItem.findMany({
    where: { shiftId: { in: shifts.map((s) => s.id) }, businessId },
    orderBy: [{ shiftId: 'asc' }, { sortOrder: 'asc' }],
  });

  const codes = Array.from(new Set(lineItems.map((li) => li.supportItemCode)));
  const catalogueItems = await prisma.ndisSupportItem.findMany({ where: { itemNumber: { in: codes } } });
  const rateLimitsMap: Record<string, number> = {};
  for (const item of catalogueItems) {
    // Use the weekday rate as the base cap reference; the actual per-line cap
    // snapshot (ndisCapRate) was already resolved by Module 4 at shift time.
    rateLimitsMap[item.itemNumber] = Number(item.nationalWeekdayRate);
  }
  // Prefer the per-line snapshot cap (ndisCapRate) when present — it reflects
  // the tier-specific cap actually applied by the Module 4 engine.
  for (const li of lineItems) {
    rateLimitsMap[li.supportItemCode] = Math.max(
      rateLimitsMap[li.supportItemCode] ?? 0,
      Number(li.ndisCapRate)
    );
  }

  // 6 — resolve recipient email
  let recipientEmail: string | null = null;
  if (client.planManagementType === PlanManagementType.PLAN_MANAGED) {
    recipientEmail = client.planManagerEmail;
  } else if (client.planManagementType === PlanManagementType.SELF_MANAGED) {
    recipientEmail = client.selfManagedBillingEmail;
  }

  // 7 — Pre-Flight Shield
  const shieldItems: ShieldLineItem[] = lineItems.map((li) => ({
    code: li.supportItemCode,
    unitPrice: Number(li.appliedRate),
    quantity: Number(li.quantity),
    serviceDate: shifts.find((s) => s.id === li.shiftId)!.shiftDate.toISOString().slice(0, 10),
  }));

  const shieldInput: ShieldInput = {
    businessAbn: business.abn,
    businessBsb: business.bsb,
    businessAccountNumber: business.accountNumber,
    businessAccountName: business.accountName,
    businessName: business.name,
    businessEmail: business.email,
    businessPhone: business.phone,
    businessAddress: business.address,
    businessState: business.state,
    participantNdisNumber: client.ndisNumber,
    participantName: client.participantName,
    planManagementType: client.planManagementType,
    planManagerAgencyName: client.planManagerAgencyName,
    planManagerEmail: client.planManagerEmail,
    selfManagedBillingEmail: client.selfManagedBillingEmail,
    recipientEmail,
    items: shieldItems,
    rateLimitsMap,
  };

  const shieldResult = validateInvoiceBeforeDispatch(shieldInput);

  if (!shieldResult.isValid) {
    throw ApiError.unprocessable('Invoice blocked by the Pre-Flight Compliance Shield.', 'INVOICE_BLOCKED_BY_SHIELD');
  }

  // 8 — totals
  const totals = calculateInvoiceTotals(lineItems.map((li) => ({ amount: Number(li.amount) })));

  // due date
  const issueDate = new Date();
  let dueDate: Date;
  if (input.dueDate) {
    dueDate = new Date(input.dueDate + 'T00:00:00Z');
    const maxDue = DateTime.fromJSDate(issueDate).plus({ days: 90 }).toJSDate();
    if (dueDate < issueDate || dueDate > maxDue) {
      throw ApiError.badRequest('Due date must be between the issue date and 90 days after it.', 'INVALID_DUE_DATE');
    }
  } else {
    dueDate = DateTime.fromJSDate(issueDate).plus({ days: env.INVOICE_DUE_DAYS || 14 }).toJSDate();
  }

  const year = issueDate.getUTCFullYear();

  // 9 — transaction: allocate number, create invoice + line items, mark shifts invoiced
  let invoiceId: string;
  try {
    invoiceId = await prisma.$transaction(async (tx) => {
      const { invoiceYear, sequenceNumber, invoiceNumber } = await allocateInvoiceNumber(
        tx,
        businessId,
        year,
        business.invoicePrefix
      );

      const created = await tx.invoice.create({
        data: {
          businessId,
          clientId: client.id,
          invoiceNumber,
          invoiceYear,
          sequenceNumber,
          issueDate,
          dueDate,
          subtotalAmount: new Prisma.Decimal(totals.subtotalAmount),
          gstAmount: new Prisma.Decimal(totals.gstAmount),
          totalAmount: new Prisma.Decimal(totals.totalAmount),
          status: InvoiceStatus.DRAFT,
          recipientEmail: recipientEmail ?? '',
          notes: input.notes ?? null,
          planManagerAgencyName: client.planManagerAgencyName,
          planManagementType: client.planManagementType,
          participantNdisNumber: client.ndisNumber,
          businessAbn: business.abn,
          businessBsb: business.bsb,
          businessAccountNumber: business.accountNumber,
          businessAccountName: business.accountName,
          businessBankName: business.bankName,
          businessName: business.name,
          businessEmail: business.email,
          businessPhone: business.phone,
          businessAddress: [business.address, business.suburb, business.state, business.postcode]
            .filter(Boolean)
            .join(', '),
          shieldReport: shieldResult as unknown as Prisma.InputJsonValue,
        },
      });

      await tx.invoiceLineItem.createMany({
        data: lineItems.map((li) => {
          const shift = shifts.find((s) => s.id === li.shiftId)!;
          return {
            invoiceId: created.id,
            serviceDate: shift.shiftDate,
            supportItemCode: li.supportItemCode,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unitPrice: li.appliedRate, // never recompute — copy the snapshot
            totalAmount: li.amount, // never recompute — copy the snapshot
          };
        }),
      });

      // Guard against a concurrent generate() for the same shifts: this update
      // only affects rows still PENDING/uninvoiced; if a concurrent transaction
      // already flipped them, updateMany's count will be short and we abort.
      const updateResult = await tx.shift.updateMany({
        where: { id: { in: shifts.map((s) => s.id) }, isInvoiced: false, status: 'PENDING' },
        data: { isInvoiced: true, status: 'INVOICED', invoiceId: created.id },
      });

      if (updateResult.count !== shifts.length) {
        throw ApiError.conflict(
          'One or more selected shifts were invoiced by a concurrent request.',
          'SHIFT_NOT_INVOICEABLE'
        );
      }

      return created.id;
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.conflict('Failed to generate the invoice. Please retry.', 'INVOICE_NUMBER_CONFLICT');
  }

  await recordAuditEvent({
    action: 'INVOICE_GENERATED',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: {
      invoiceId,
      shiftCount: shifts.length,
      lineItemCount: lineItems.length,
      totalAmount: totals.totalAmount,
      shieldPassed: true,
    },
  });

  // 10 — PDF generation
  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await buildPdfForInvoice(invoiceId);
  } catch (err) {
    logger.error('PDF generation failed for invoice', { invoiceId, err });
    throw new ApiError(500, 'PDF_GENERATION_FAILED', 'Invoice was created but PDF generation failed.', { invoiceId });
  }

  // 11 — dispatch (unless NDIA_MANAGED)
  const warnings: string[] = [];
  let dispatch: { status: string; to: string | null; messageId: string | null; bcc: string | null };

  const stored = await getInvoiceById(invoiceId, businessId);

  if (client.planManagementType === PlanManagementType.NDIA_MANAGED) {
    dispatch = { status: 'SKIPPED_NDIA_MANAGED', to: null, messageId: null, bcc: null };
  } else {
    dispatch = await dispatchInvoiceEmail({
      invoice: stored,
      to: recipientEmail!,
      bcc: business.email,
      pdfBuffer,
      pdfFilename: invoicePdfFilename({ invoiceNumber: stored.invoiceNumber }),
      businessName: business.name,
      bankSummary: { bankName: business.bankName, bsb: business.bsb, accountNumber: business.accountNumber },
    });

    if (dispatch.status === 'SENT') {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'SENT', sentAt: new Date(), lastSentAt: new Date(), emailMessageId: dispatch.messageId },
      });
      await recordAuditEvent({
        action: 'INVOICE_SENT',
        businessId,
        userId,
        ipAddress,
        userAgent,
        metadata: { invoiceId, invoiceNumber: stored.invoiceNumber, to: dispatch.to, bcc: dispatch.bcc, messageId: dispatch.messageId, lineItemCount: lineItems.length },
      });
    } else if (dispatch.status === 'FAILED') {
      warnings.push('EMAIL_DISPATCH_FAILED');
    }
  }

  await recalculateClientBudgetSpent(client.id, businessId);

  const finalInvoice = await getInvoiceById(invoiceId, businessId);

  return {
    invoice: finalInvoice,
    shield: shieldResult,
    dispatch,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// PDF building (shared by generate + /pdf endpoint) — always from snapshots
// ---------------------------------------------------------------------------

async function buildPdfForInvoice(invoiceId: string, businessId?: string): Promise<Buffer> {
  const invoice = await prisma.invoice.findFirst({
    where: businessId ? { id: invoiceId, businessId } : { id: invoiceId },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const client = await prisma.client.findUnique({ where: { id: invoice.clientId } });

  let budget: InvoicePdfInput['budget'] = null;
  if (client?.allocatedBudgetTotal) {
    budget = { allocated: Number(client.allocatedBudgetTotal), spent: Number(client.allocatedBudgetSpent) };
  }

  const pdfInput: InvoicePdfInput = {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    businessName: invoice.businessName ?? '',
    businessAbn: invoice.businessAbn ?? '',
    businessEmail: invoice.businessEmail ?? '',
    businessPhone: invoice.businessPhone,
    businessAddress: invoice.businessAddress,
    participantName: invoice.client?.participantName ?? '',
    participantNdisNumber: invoice.participantNdisNumber ?? '',
    planManagementType: (invoice.planManagementType ?? 'PLAN_MANAGED') as InvoicePdfInput['planManagementType'],
    planManagerAgencyName: invoice.planManagerAgencyName,
    planManagerEmail: invoice.planManagementType === 'PLAN_MANAGED' ? invoice.recipientEmail : null,
    bankName: invoice.businessBankName,
    accountName: invoice.businessAccountName,
    bsb: invoice.businessBsb,
    accountNumber: invoice.businessAccountNumber,
    lineItems: invoice.lineItems.map((li) => ({
      serviceDate: li.serviceDate.toISOString().slice(0, 10),
      supportItemCode: li.supportItemCode,
      description: li.description,
      quantity: Number(li.quantity),
      unit: (li as unknown as { unit?: string }).unit ?? 'Hour',
      unitPrice: Number(li.unitPrice),
      totalAmount: Number(li.totalAmount),
    })),
    subtotalAmount: Number(invoice.subtotalAmount),
    gstAmount: Number(invoice.gstAmount),
    totalAmount: Number(invoice.totalAmount),
    notes: invoice.notes ?? null,
    budget,
  };

  return generateInvoicePdf(pdfInput);
}

// ---------------------------------------------------------------------------
// List / detail
// ---------------------------------------------------------------------------

export async function listInvoices(businessId: string, query: ListInvoicesQuery) {
  const page = query.page || 1;
  const pageSize = query.pageSize || 20;
  const skip = paginationSkip(page, pageSize);

  const where: Prisma.InvoiceWhereInput = { businessId };
  if (query.status) where.status = query.status;
  if (query.clientId) where.clientId = query.clientId;
  if (query.from || query.to) {
    where.issueDate = {};
    if (query.from) (where.issueDate as Prisma.DateTimeFilter).gte = new Date(query.from + 'T00:00:00Z');
    if (query.to) (where.issueDate as Prisma.DateTimeFilter).lte = new Date(query.to + 'T23:59:59Z');
  }

  const orderBy: Prisma.InvoiceOrderByWithRelationInput = { [query.sort]: query.order };

  const [items, totalRecords, sentAgg, paidAgg, sumAgg] = await Promise.all([
    prisma.invoice.findMany({ where, skip, take: pageSize, orderBy, include: INVOICE_INCLUDE }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { ...where, status: 'SENT' }, _sum: { totalAmount: true } }),
    prisma.invoice.aggregate({ where: { ...where, status: 'PAID' }, _sum: { totalAmount: true } }),
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true } }),
  ]);

  return {
    items: items.map((i) => toInvoiceView(i)),
    pagination: buildPaginationMeta(page, pageSize, totalRecords),
    summary: {
      totalAmount: Number(sumAgg._sum.totalAmount ?? 0),
      count: totalRecords,
      outstandingAmount: Number(sentAgg._sum.totalAmount ?? 0),
      paidAmount: Number(paidAgg._sum.totalAmount ?? 0),
    },
  };
}

export async function getInvoiceById(id: string, businessId: string): Promise<InvoiceView> {
  const invoice = await prisma.invoice.findFirst({ where: { id, businessId }, include: INVOICE_INCLUDE });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');
  return toInvoiceView(invoice);
}

export async function getInvoicePdf(id: string, businessId: string, ctx: InvoiceContext): Promise<{ buffer: Buffer; filename: string }> {
  const invoice = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  const buffer = await buildPdfForInvoice(id, businessId);

  await recordAuditEvent({
    action: 'INVOICE_PDF_VIEWED',
    businessId,
    userId: ctx.userId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { invoiceId: id, invoiceNumber: invoice.invoiceNumber },
  });

  return { buffer, filename: `${invoice.invoiceNumber}.pdf` };
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

export async function resendInvoice(id: string, overrideTo: string | undefined, ctx: InvoiceContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  const invoice = await prisma.invoice.findFirst({ where: { id, businessId }, include: INVOICE_INCLUDE });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (invoice.status === 'CANCELLED') {
    throw ApiError.conflict('Cancelled invoices cannot be resent.', 'INVOICE_CANCELLED');
  }
  if (invoice.planManagementType === 'NDIA_MANAGED') {
    throw ApiError.unprocessable('NDIA-managed invoices are never emailed.', 'INVOICE_NOT_EMAILLABLE');
  }

  if (!isEmailConfigured()) {
    throw ApiError.serviceUnavailable('Email is not configured for this server.', 'EMAIL_NOT_CONFIGURED');
  }

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw ApiError.notFound('Business not found.');

  const to = overrideTo || invoice.recipientEmail;
  if (!to) throw ApiError.unprocessable('No recipient email is available for this invoice.', 'INVOICE_NOT_EMAILLABLE');

  const pdfBuffer = await buildPdfForInvoice(id, businessId);
  const view = toInvoiceView(invoice);

  const dispatch = await dispatchInvoiceEmail({
    invoice: view,
    to,
    bcc: business.email,
    pdfBuffer,
    pdfFilename: `${invoice.invoiceNumber}.pdf`,
    businessName: business.name,
    bankSummary: { bankName: business.bankName, bsb: business.bsb, accountNumber: business.accountNumber },
  });

  if (dispatch.status !== 'SENT') {
    throw ApiError.serviceUnavailable('Failed to resend the invoice email.', 'EMAIL_DISPATCH_FAILED');
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: 'SENT', sentAt: invoice.sentAt ?? new Date(), lastSentAt: new Date(), emailMessageId: dispatch.messageId },
    include: INVOICE_INCLUDE,
  });

  await recordAuditEvent({
    action: 'INVOICE_RESENT',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: { invoiceId: id, invoiceNumber: invoice.invoiceNumber, to, messageId: dispatch.messageId },
  });

  return toInvoiceView(updated);
}

// ---------------------------------------------------------------------------
// Mark paid / reject / cancel
// ---------------------------------------------------------------------------

export async function markInvoicePaid(
  id: string,
  input: { paidAt?: string; amount?: number },
  ctx: InvoiceContext
) {
  const { businessId, userId, ipAddress, userAgent } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (invoice.status === 'PAID') {
    return { invoice: toInvoiceView(await prisma.invoice.findFirstOrThrow({ where: { id }, include: INVOICE_INCLUDE })), alreadyPaid: true };
  }

  if (invoice.status !== 'SENT') {
    throw ApiError.conflict('Only sent invoices can be marked as paid.', 'INVOICE_NOT_SENT');
  }

  if (input.amount !== undefined && Math.abs(input.amount - Number(invoice.totalAmount)) > 0.001) {
    throw ApiError.unprocessable('The paid amount does not match the invoice total.', 'PAID_AMOUNT_MISMATCH');
  }

  const paidAt = input.paidAt ? new Date(input.paidAt + 'T00:00:00Z') : new Date();

  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: 'PAID', paidAt },
    include: INVOICE_INCLUDE,
  });

  await recordAuditEvent({
    action: 'INVOICE_PAID',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: { invoiceId: id, invoiceNumber: invoice.invoiceNumber, paidAt: paidAt.toISOString(), amount: Number(invoice.totalAmount) },
  });

  return { invoice: toInvoiceView(updated), alreadyPaid: false };
}

export async function rejectInvoice(id: string, reason: string, ctx: InvoiceContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (invoice.status !== 'SENT') {
    throw ApiError.conflict('Only sent invoices can be rejected.', 'INVOICE_NOT_SENT');
  }

  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: 'REJECTED', rejectionReason: reason },
    include: INVOICE_INCLUDE,
  });

  await recordAuditEvent({
    action: 'INVOICE_REJECTED',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: { invoiceId: id, invoiceNumber: invoice.invoiceNumber, reason },
  });

  return toInvoiceView(updated);
}

export async function cancelInvoice(id: string, ctx: InvoiceContext) {
  const { businessId, userId, ipAddress, userAgent } = ctx;
  const invoice = await prisma.invoice.findFirst({ where: { id, businessId } });
  if (!invoice) throw ApiError.notFound('Invoice not found.', 'INVOICE_NOT_FOUND');

  if (invoice.status === 'PAID') {
    throw ApiError.conflict('Paid invoices cannot be cancelled.', 'INVOICE_PAID_IMMUTABLE');
  }
  if (invoice.status === 'CANCELLED') {
    throw ApiError.conflict('This invoice is already cancelled.', 'INVOICE_ALREADY_CANCELLED');
  }
  if (invoice.status !== 'DRAFT' && invoice.status !== 'SENT') {
    throw ApiError.conflict('Only draft or sent invoices can be cancelled.', 'INVOICE_NOT_CANCELLABLE');
  }

  const releasedShiftIds = (await prisma.shift.findMany({ where: { invoiceId: id }, select: { id: true } })).map(
    (s) => s.id
  );

  const updated = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: INVOICE_INCLUDE,
    });
    await tx.shift.updateMany({
      where: { invoiceId: id },
      data: { isInvoiced: false, status: 'PENDING', invoiceId: null },
    });
    return inv;
  });

  await recalculateClientBudgetSpent(invoice.clientId, businessId);

  await recordAuditEvent({
    action: 'INVOICE_CANCELLED',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: { invoiceId: id, invoiceNumber: invoice.invoiceNumber, releasedShiftIds },
  });

  return toInvoiceView(updated);
}

// ---------------------------------------------------------------------------
// PRODA / Myplace CSV export (Pro only) — spec 2.9
// ---------------------------------------------------------------------------

export async function exportProdaCsv(query: ProdaExportQuery, ctx: InvoiceContext): Promise<{ csv: string; filename: string; rowCount: number }> {
  const { businessId, userId, ipAddress, userAgent } = ctx;

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw ApiError.notFound('Business not found.');
  if (business.planTier !== 'PRO') {
    throw ApiError.forbidden('PRODA CSV export requires the Pro plan.', 'PRODA_EXPORT_REQUIRES_PRO');
  }

  const where: Prisma.InvoiceWhereInput = {
    businessId,
    status: { in: ['SENT', 'PAID'] },
    issueDate: { gte: new Date(query.from + 'T00:00:00Z'), lte: new Date(query.to + 'T23:59:59Z') },
  };
  if (query.clientId) where.clientId = query.clientId;

  const invoices = await prisma.invoice.findMany({
    where,
    include: { lineItems: true, client: { select: { participantName: true } } },
  });

  const rows: ProdaCsvRow[] = [];
  for (const inv of invoices) {
    for (const li of inv.lineItems) {
      rows.push({
        registrationNumber: business.abn ?? '',
        participantNdisNumber: inv.participantNdisNumber ?? '',
        participantName: inv.client?.participantName ?? '',
        serviceDate: li.serviceDate.toISOString().slice(0, 10),
        supportItemNumber: li.supportItemCode,
        supportItemName: li.description,
        quantity: Number(li.quantity),
        unit: (li as unknown as { unit?: string }).unit ?? 'Hour',
        rate: Number(li.unitPrice),
        amount: Number(li.totalAmount),
        invoiceNumber: inv.invoiceNumber,
      });
    }
  }

  const csv = buildProdaCsv(rows);
  const filename = prodaCsvFilename(query.from, query.to);

  await recordAuditEvent({
    action: 'PRODA_EXPORT_GENERATED',
    businessId,
    userId,
    ipAddress,
    userAgent,
    metadata: { from: query.from, to: query.to, rowCount: rows.length, clientId: query.clientId ?? null },
  });

  return { csv, filename, rowCount: rows.length };
}
