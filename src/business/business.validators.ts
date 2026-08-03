import { z } from 'zod';
import { UserRole, UserStatus } from '@prisma/client';
import { emailSchema, passwordSchema } from '../auth/auth.validators';
import { paginationQuerySchema } from '../utils/pagination';

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

export const updateBusinessSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2).max(150).optional(),
      phone: z.string().trim().min(7).max(20).optional(),
      industry: z.string().trim().max(100).optional(),
    })
    .refine((data) => Object.keys(data).length > 0, { message: 'At least one field must be provided.' }),
});
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>['body'];
