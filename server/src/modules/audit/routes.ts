import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parseQuery, parseParams } from '../../shared/validate.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, getClinicIdForRequest } from '../../shared/access.js';

export async function auditRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.AUDIT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      entityType: z.string().max(60).optional(),
      entityId: z.string().max(64).optional(),
      action: z.string().max(60).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
    }));

    const where: Record<string, unknown> = {};
    if (req.auth!.roles.includes('SUPER_ADMIN') && !q.clinicId) {
      // Super admin may view across clinics.
    } else {
      const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
      assertClinicAccess(req.auth, clinicId);
      where.clinicId = clinicId;
    }
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.action) where.action = q.action;
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, q.pageSize ?? 50));
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    return reply.send({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  });

  // Full audit trail for a single entity (e.g. one prescription).
  app.get('/entity/:entityType/:entityId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.AUDIT_VIEW)] }, async (req, reply) => {
    const { entityType, entityId } = parseParams(req, z.object({ entityType: z.string().min(1).max(60), entityId: z.string().min(1).max(64) }));
    const items = await prisma.auditLog.findMany({
      where: { entityType, entityId },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (items.length > 0 && items[0]!.clinicId) {
      assertClinicAccess(req.auth, items[0]!.clinicId);
    }
    return reply.send({ items });
  });
}
