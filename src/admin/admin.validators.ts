import { z } from 'zod';

export const listBusinessesQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().optional(),
    status: z.enum(['TRIALING', 'ACTIVE', 'READ_ONLY', 'SUSPENDED']).optional(),
  }),
});

export const listUsersQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().optional(),
    role: z.enum(['OWNER', 'OFFICE_MANAGER', 'TECHNICIAN', 'SUPER_ADMIN']).optional(),
    status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED']).optional(),
  }),
});

export const updateBusinessStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Business ID format.'),
  }),
  body: z.object({
    status: z.enum(['TRIALING', 'ACTIVE', 'READ_ONLY', 'SUSPENDED']),
    reason: z.string().optional(),
  }),
});

export const extendTrialSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Business ID format.'),
  }),
  body: z.object({
    days: z.coerce.number().int().min(1).max(365).default(9),
  }),
});

export const businessIdParamSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid Business ID format.'),
  }),
});

export type ListBusinessesQuery = z.infer<typeof listBusinessesQuerySchema>['query'];
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>['query'];
export type UpdateBusinessStatusInput = z.infer<typeof updateBusinessStatusSchema>['body'];
export type ExtendTrialInput = z.infer<typeof extendTrialSchema>['body'];
