import { z } from 'zod';
import { UserRole, UserStatus } from '@prisma/client';
import { emailSchema, passwordSchema } from '../auth/auth.validators';
import { paginationQuerySchema } from '../utils/pagination';
import { validateAbn, AUSTRALIAN_STATES } from './australianCompliance.util';

/**
 * Only Office Manager and Technician can be invited — an Owner is created
 * exclusively via registration (BACKEND-03 §3).
 */
const invitableRoleSchema = z.enum([UserRole.OFFICE_MANAGER, UserRole.TECHNICIAN]);

export const inviteTeamMemberSchema = z.object({
  body: z.object({
    email: emailSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    role: invitableRoleSchema,
  }),
});
export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>['body'];

export const acceptInviteSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    password: passwordSchema,
  }),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>['body'];

export const listTeamQuerySchema = z.object({
  query: paginationQuerySchema.extend({
    role: z.nativeEnum(UserRole).optional(),
    status: z.nativeEnum(UserStatus).optional(),
  }),
});
export type ListTeamQuery = z.infer<typeof listTeamQuerySchema>['query'];

export const userIdParamSchema = z.object({
  params: z.object({
    userId: z.string().uuid('A valid user ID is required.'),
  }),
});

/**
 * Module 2: Australian Business Profile & Compliance Schema
 */
export const updateBusinessProfileSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2, 'Business name must be at least 2 characters.').max(150).optional(),
      phone: z.string().trim().min(7, 'Phone number must be at least 7 characters.').max(25).optional(),
      industry: z.string().trim().max(100).optional(),
      abn: z
        .string()
        .trim()
        .refine(
          (val) => !val || validateAbn(val).isValid,
          { message: 'Invalid Australian Business Number (ABN). Must be 11 numeric digits matching ATO Modulo 89 checksum.' }
        )
        .optional()
        .nullable(),
      bsb: z
        .string()
        .trim()
        .regex(/^\d{3}-?\d{3}$/, 'BSB must be 6 numeric digits (e.g. 062-000 or 062000).')
        .optional()
        .nullable(),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{6,9}$/, 'Account number must be 6 to 9 numeric digits.')
        .optional()
        .nullable(),
      accountName: z.string().trim().min(2).max(100).optional().nullable(),
      bankName: z.string().trim().min(2).max(100).optional().nullable(),
      invoicePrefix: z
        .string()
        .trim()
        .min(1, 'Invoice prefix must be at least 1 character.')
        .max(10, 'Invoice prefix cannot exceed 10 characters.')
        .regex(/^[A-Za-z0-9-_]+$/, 'Invoice prefix can only contain letters, numbers, hyphens, and underscores.')
        .optional(),
      isGstRegistered: z.boolean().optional(),
      address: z.string().trim().max(200).optional().nullable(),
      suburb: z.string().trim().max(100).optional().nullable(),
      state: z.enum(AUSTRALIAN_STATES).optional().nullable(),
      postcode: z
        .string()
        .trim()
        .regex(/^\d{4}$/, 'Australian postcode must be 4 digits.')
        .optional()
        .nullable(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided to update.' }),
});
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>['body'];

/**
 * Module 2: Banking Details Specific Schema
 */
export const updateBankDetailsSchema = z.object({
  body: z.object({
    bsb: z
      .string()
      .trim()
      .regex(/^\d{3}-?\d{3}$/, 'BSB must be 6 numeric digits (e.g. 062-000).'),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{6,9}$/, 'Account number must be 6 to 9 numeric digits.'),
    accountName: z.string().trim().min(2).max(100).optional().nullable(),
    bankName: z.string().trim().min(2).max(100).optional().nullable(),
  }),
});
export type UpdateBankDetailsInput = z.infer<typeof updateBankDetailsSchema>['body'];

/**
 * Module 2: Standalone ABN Validation Schema
 */
export const validateAbnRequestSchema = z.object({
  body: z.object({
    abn: z.string().trim().min(1, 'ABN is required for validation.'),
  }),
});
export type ValidateAbnRequestInput = z.infer<typeof validateAbnRequestSchema>['body'];
