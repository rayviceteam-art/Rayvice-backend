/**
 * MODULE 4 — request validators
 * src/shifts/shift.validators.ts
 */
import { z } from 'zod';
import { DateTime } from 'luxon';
import { ApiError } from '../utils/ApiError';

const MAX_BACKDATE_DAYS = 90; // Section 5.6 — constant, not an env var

const TIME_HHMM = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Must be 24-hour HH:mm');
const DATE_YYYY_MM_DD = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

/**
 * Validates the shift date is a real calendar date, not in the future, and
 * not older than MAX_BACKDATE_DAYS — evaluated in the BUSINESS timezone
 * (caller passes the resolved business timezone, defaulting to
 * 'Australia/Sydney' if the business record has none).
 */
export function assertShiftDateInWindow(shiftDate: string, businessTimezone: string): void {
  const date = DateTime.fromISO(shiftDate, { zone: businessTimezone });
  if (!date.isValid) {
    throw ApiError.unprocessable('Invalid shift date.', 'SHIFT_DATE_INVALID');
  }
  const today = DateTime.now().setZone(businessTimezone).startOf('day');
  if (date.startOf('day') > today) {
    throw ApiError.unprocessable("You can't log a shift in the future.", 'SHIFT_DATE_IN_FUTURE');
  }
  const oldestAllowed = today.minus({ days: MAX_BACKDATE_DAYS });
  if (date.startOf('day') < oldestAllowed) {
    throw ApiError.unprocessable(
      `Shifts can only be logged up to ${MAX_BACKDATE_DAYS} days back.`,
      'SHIFT_DATE_TOO_OLD'
    );
  }
}

export const createShiftSchema = z.object({
  clientId: z.string().uuid(),
  shiftDate: DATE_YYYY_MM_DD,
  startTime: TIME_HHMM,
  endTime: TIME_HHMM,
  travelKms: z
    .number()
    .min(0)
    .max(500)
    .refine((v) => Number.isInteger(v * 100), 'Max 2 decimal places')
    .optional(),
  caseNotes: z.string().max(2000).optional(),
  isPublicHoliday: z.boolean().nullable().optional(),
  supportItemCode: z.string().optional(),
  timezone: z.string().optional(), // accepted but ignored server-side (Section 12.1)
});
export type CreateShiftBody = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    shiftDate: DATE_YYYY_MM_DD.optional(),
    startTime: TIME_HHMM.optional(),
    endTime: TIME_HHMM.optional(),
    travelKms: z
      .number()
      .min(0)
      .max(500)
      .refine((v) => Number.isInteger(v * 100), 'Max 2 decimal places')
      .optional(),
    caseNotes: z.string().max(2000).optional(),
    isPublicHoliday: z.boolean().nullable().optional(),
    supportItemCode: z.string().optional(),
  })
  .strict(); // clientId/userId/id/createdAt are immutable (decision D20) — reject silently-dropped fields
export type UpdateShiftBody = z.infer<typeof updateShiftSchema>;

export const listShiftsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  from: DATE_YYYY_MM_DD.optional(),
  to: DATE_YYYY_MM_DD.optional(),
  clientId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'INVOICED', 'CANCELLED']).optional(),
  isInvoiced: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  sort: z.enum(['shiftDate', 'createdAt', 'totalAmount']).default('shiftDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListShiftsQuery = z.infer<typeof listShiftsQuerySchema>;

export const voiceParseBodySchema = z.object({
  timezone: z.string().optional(),
});

/** Zod schema for the Gemini structured-extraction output (Section 11.5). */
export const voiceParseAiSchema = z.object({
  clientFirstName: z.string().nullable(),
  shiftDate: DATE_YYYY_MM_DD.nullable(),
  startTime: TIME_HHMM.nullable(),
  endTime: TIME_HHMM.nullable(),
  travelKms: z.number().nullable(),
  caseNotes: z.string().max(1000).nullable(),
  confidence: z.number().min(0).max(1),
  missingFields: z.array(z.string()),
});
export type VoiceParseAiOutput = z.infer<typeof voiceParseAiSchema>;

// ---------------------------------------------------------------------------
// Request wrappers — the existing validateRequest() middleware expects a
// single Zod object with body / query / params keys.
// ---------------------------------------------------------------------------

export const createShiftRequestSchema = z.object({ body: createShiftSchema });

export const updateShiftRequestSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid shift ID format.') }),
  body: updateShiftSchema,
});

export const listShiftsRequestSchema = z.object({ query: listShiftsQuerySchema });

export const shiftIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid('Invalid shift ID format.') }),
});
