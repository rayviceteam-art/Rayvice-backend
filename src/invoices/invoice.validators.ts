import { z } from 'zod';
import { paginationQuerySchema } from '../utils/pagination';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

export const generateInvoiceBodySchema = z.object({
  clientId: z.string().uuid(),
  shiftIds: z
    .array(z.string().uuid())
    .min(1, 'Select at least one shift.')
    .max(50, 'A single invoice can include at most 50 shifts.')
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate shift ids are not allowed.' }),
  dueDate: dateOnly.optional(),
  notes: z.string().max(500).optional(),
});

export const generateInvoiceSchema = z.object({ body: generateInvoiceBodySchema });

export type GenerateInvoiceInput = z.infer<typeof generateInvoiceBodySchema>;

export const listInvoicesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'REJECTED', 'CANCELLED']).optional(),
  clientId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
  sort: z.enum(['issueDate', 'totalAmount', 'invoiceNumber']).optional().default('issueDate'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
});

export const listInvoicesSchema = z.object({ query: listInvoicesQuerySchema });
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

const idParamSchema = z.object({ params: z.object({ id: z.string().uuid() }) });
export const invoiceIdSchema = idParamSchema;

export const resendInvoiceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ to: z.string().email().optional() }).optional().default({}),
});

export const markPaidSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      paidAt: dateOnly.optional(),
      amount: z.number().positive().optional(),
    })
    .optional()
    .default({}),
});

export const rejectInvoiceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({ reason: z.string().min(3).max(500) }),
});

export const cancelInvoiceSchema = idParamSchema;

export const prodaExportQuerySchema = z.object({
  from: dateOnly,
  to: dateOnly,
  clientId: z.string().uuid().optional(),
});

export const prodaExportSchema = z.object({ query: prodaExportQuerySchema });
export type ProdaExportQuery = z.infer<typeof prodaExportQuerySchema>;
