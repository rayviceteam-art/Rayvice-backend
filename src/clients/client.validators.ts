import { z } from 'zod';
import { PlanManagementType } from '@prisma/client';
import { paginationQuerySchema } from '../utils/pagination';

// ---------------------------------------------------------------------------
// Shared Field Schemas
// ---------------------------------------------------------------------------

export const ndisNumberRegex = /^\d{9}$/;

export const ndisNumberSchema = z
  .string({ required_error: 'NDIS number is required.' })
  .trim()
  .regex(ndisNumberRegex, 'NDIS number must be exactly 9 numeric digits.');

export const participantNameSchema = z
  .string({ required_error: 'Participant name is required.' })
  .trim()
  .min(1, 'Participant name cannot be empty.')
  .max(150, 'Participant name cannot exceed 150 characters.');

export const planManagementTypeSchema = z.nativeEnum(PlanManagementType, {
  errorMap: () => ({ message: 'planManagementType must be PLAN_MANAGED, SELF_MANAGED, or NDIA_MANAGED.' }),
});

export const nonNegativeDecimal = (fieldName: string) =>
  z
    .number({ invalid_type_error: `${fieldName} must be a valid number.` })
    .nonnegative(`${fieldName} cannot be negative.`)
    .refine((val) => Number(val.toFixed(2)) === val, {
      message: `${fieldName} must have at most 2 decimal places.`,
    });

export const isoDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dateOfBirth must be in ISO format (YYYY-MM-DD).')
  .refine((val) => !Number.isNaN(Date.parse(val)), 'dateOfBirth must be a valid date.');

// ---------------------------------------------------------------------------
// Create Client Request Schema (POST /api/v1/clients)
// ---------------------------------------------------------------------------

const createClientBodySchema = z
  .object({
    participantName: participantNameSchema,
    ndisNumber: ndisNumberSchema,
    dateOfBirth: isoDateOnly.optional().nullable(),
    planManagementType: planManagementTypeSchema.default(PlanManagementType.PLAN_MANAGED),
    planManagerAgencyName: z.string().trim().min(1, 'Agency name cannot be empty.').max(150).optional().nullable(),
    planManagerEmail: z.string().trim().email('Must be a valid email address.').max(150).optional().nullable(),
    selfManagedBillingEmail: z.string().trim().email('Must be a valid email address.').max(150).optional().nullable(),
    selfManagedBillingPhone: z.string().trim().min(1).max(30).optional().nullable(),
    hourlyRateAgreed: nonNegativeDecimal('hourlyRateAgreed').optional().nullable(),
    defaultSupportItemCode: z.string().trim().min(1).max(50).optional().nullable(),
    allocatedBudgetTotal: nonNegativeDecimal('allocatedBudgetTotal').optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.planManagementType === PlanManagementType.PLAN_MANAGED) {
      if (!data.planManagerAgencyName || data.planManagerAgencyName.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planManagerAgencyName'],
          message: 'Plan Manager agency name is required for PLAN_MANAGED participants.',
        });
      }
      if (!data.planManagerEmail || data.planManagerEmail.trim() === '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['planManagerEmail'],
          message: 'Plan Manager claims email is required for PLAN_MANAGED participants.',
        });
      }
    }
  });

export const createClientSchema = z.object({
  body: createClientBodySchema,
});

export type CreateClientInput = z.infer<typeof createClientBodySchema>;

// ---------------------------------------------------------------------------
// Update Client Request Schema (PUT /api/v1/clients/:id)
// ---------------------------------------------------------------------------

const updateClientBodySchema = z
  .object({
    participantName: participantNameSchema.optional(),
    dateOfBirth: isoDateOnly.optional().nullable(),
    planManagementType: planManagementTypeSchema.optional(),
    planManagerAgencyName: z.string().trim().min(1).max(150).optional().nullable(),
    planManagerEmail: z.string().trim().email('Must be a valid email address.').max(150).optional().nullable(),
    selfManagedBillingEmail: z.string().trim().email('Must be a valid email address.').max(150).optional().nullable(),
    selfManagedBillingPhone: z.string().trim().min(1).max(30).optional().nullable(),
    hourlyRateAgreed: nonNegativeDecimal('hourlyRateAgreed').optional().nullable(),
    defaultSupportItemCode: z.string().trim().min(1).max(50).optional().nullable(),
    allocatedBudgetTotal: nonNegativeDecimal('allocatedBudgetTotal').optional().nullable(),
    isActive: z.boolean().optional(),
  });

export const updateClientSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid client ID format.'),
  }),
  body: updateClientBodySchema,
});

export type UpdateClientInput = z.infer<typeof updateClientBodySchema>;

// ---------------------------------------------------------------------------
// List Query Schema (GET /api/v1/clients)
// ---------------------------------------------------------------------------

export const listClientsQuerySchema = z.object({
  query: paginationQuerySchema.extend({
    search: z.string().trim().optional(),
    isActive: z
      .string()
      .optional()
      .transform((val) => {
        if (val === 'true') return true;
        if (val === 'false') return false;
        return undefined;
      }),
    planManagementType: planManagementTypeSchema.optional(),
  }),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>['query'];

// ---------------------------------------------------------------------------
// Single Client Param Schema (GET/DELETE /api/v1/clients/:id)
// ---------------------------------------------------------------------------

export const clientIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid client ID format.'),
  }),
});

export type ClientIdParam = z.infer<typeof clientIdParamSchema>['params'];
