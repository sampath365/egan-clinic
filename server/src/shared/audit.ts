import type { FastifyRequest } from 'fastify';
import { prisma } from './prisma.js';
import { getClientIp } from './utils.js';

export interface AuditInput {
  clinicId?: string | null;
  userId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  req?: FastifyRequest;
}

/**
 * Writes an audit record. Audit writes are best-effort: a failure here must not
 * break the business operation, but it is logged so it can be alerted on.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId: input.clinicId ?? null,
        userId: input.userId ?? null,
        actorName: input.actorName ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
        ipAddress: input.req ? getClientIp(input.req) : null,
        userAgent: input.req ? String(input.req.headers['user-agent'] ?? '') : null,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record audit entry', { action: input.action, entityType: input.entityType });
  }
}
