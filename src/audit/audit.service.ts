import { AuditAction, Prisma } from '@prisma/client';
import { prisma } from '../config/database';
import { logger } from '../config/logger';

export interface AuditEventInput {
  action: AuditAction;
  businessId?: string | null;
  userId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Persists an immutable audit log entry.
 *
 * BACKEND-03 §13 — "Audit logs must be immutable." Accordingly, no update or
 * delete method is ever exposed for AuditLog records anywhere in the codebase.
 *
 * Auditing failures must never break the primary request flow, so write
 * errors are logged and swallowed rather than propagated.
 */
export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        businessId: input.businessId ?? null,
        userId: input.userId ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log entry', { action: input.action, error });
  }
}
