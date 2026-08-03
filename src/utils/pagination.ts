import { z } from 'zod';

/**
 * BACKEND-04 §9 — large datasets must support page number, page size,
 * total records, and total pages.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalRecords: number;
  totalPages: number;
}

export function buildPaginationMeta(page: number, pageSize: number, totalRecords: number): PaginationMeta {
  return {
    page,
    pageSize,
    totalRecords,
    totalPages: Math.max(1, Math.ceil(totalRecords / pageSize)),
  };
}

export function paginationSkip(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
