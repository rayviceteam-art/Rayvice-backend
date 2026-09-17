import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/ApiResponse';
import * as invoiceService from './invoice.service';

function ctxFrom(req: any) {
  return {
    businessId: req.user!.businessId,
    userId: req.user!.id,
    ipAddress: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
  };
}

export const generateInvoice = asyncHandler(async (req, res) => {
  const result = await invoiceService.generateInvoice(req.body, ctxFrom(req));
  sendSuccess(res, 201, 'Invoice generated.', result);
});

export const listInvoices = asyncHandler(async (req, res) => {
  const result = await invoiceService.listInvoices(req.user!.businessId, req.query as any);
  sendSuccess(res, 200, 'Invoices retrieved.', result);
});

export const getInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.getInvoiceById(req.params.id as string, req.user!.businessId);
  sendSuccess(res, 200, 'Invoice retrieved.', { invoice });
});

export const getInvoicePdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await invoiceService.getInvoicePdf(req.params.id as string, req.user!.businessId, ctxFrom(req));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.send(buffer);
});

export const resendInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.resendInvoice(req.params.id as string, req.body?.to, ctxFrom(req));
  sendSuccess(res, 200, 'Invoice resent.', { invoice });
});

export const markInvoicePaid = asyncHandler(async (req, res) => {
  const result = await invoiceService.markInvoicePaid(req.params.id as string, req.body ?? {}, ctxFrom(req));
  sendSuccess(res, 200, 'Invoice marked as paid.', result);
});

export const rejectInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.rejectInvoice(req.params.id as string, req.body.reason, ctxFrom(req));
  sendSuccess(res, 200, 'Invoice rejected.', { invoice });
});

export const cancelInvoice = asyncHandler(async (req, res) => {
  const invoice = await invoiceService.cancelInvoice(req.params.id as string, ctxFrom(req));
  sendSuccess(res, 200, 'Invoice cancelled.', { invoice });
});

export const exportProdaCsv = asyncHandler(async (req, res) => {
  const { csv, filename } = await invoiceService.exportProdaCsv(req.query as any, ctxFrom(req));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});
