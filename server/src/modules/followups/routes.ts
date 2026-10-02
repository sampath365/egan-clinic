import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { NOTIFICATION_TYPE } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';

export async function followUpRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(), doctorId: z.string().optional(),
      status: z.string().optional(), dueBefore: z.string().optional(),
    }));
    const where: Record<string, unknown> = {};
    if (req.auth!.clinicIds.length === 0 && req.auth!.patientIds.length > 0) {
      where.patientId = { in: req.auth!.patientIds };
    } else {
      const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
      assertClinicAccess(req.auth, clinicId);
      where.clinicId = clinicId;
    }
    if (q.doctorId) where.doctorId = q.doctorId;
    if (q.status) where.status = q.status;
    if (q.dueBefore) where.dueDate = { lte: new Date(q.dueBefore) };

    const followUps = await prisma.followUp.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, patientCode: true, mobile: true } },
        doctor: { select: { id: true, name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 200,
    });
    return reply.send({ followUps });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().max(64).optional(),
      patientId: z.string().min(1).max(64),
      doctorId: z.string().min(1).max(64),
      consultationId: z.string().max(64).optional(),
      prescriptionId: z.string().max(64).optional(),
      dueDate: z.coerce.date(),
      instructions: z.string().max(1000).optional(),
    }));
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);

    const followUp = await prisma.followUp.create({ data: { ...body, clinicId } });
    await notificationService.notifyPatient(body.patientId, {
      clinicId,
      type: NOTIFICATION_TYPE.FOLLOW_UP_REMINDER,
      title: 'Follow-up scheduled',
      body: `Your follow-up is scheduled for ${body.dueDate.toLocaleDateString()}.`,
      entityType: 'FollowUp',
      entityId: followUp.id,
    });
    return reply.code(201).send({ followUp });
  });

  app.patch('/:id/status', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({ status: z.enum(['PENDING', 'DONE', 'MISSED', 'CANCELLED']) }));
    const existing = await prisma.followUp.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Follow-up not found');
    assertClinicAccess(req.auth, existing.clinicId);
    const followUp = await prisma.followUp.update({ where: { id }, data: { status: body.status } });
    return reply.send({ followUp });
  });

  // Sends reminders for follow-ups due within the next 24 hours.
  app.post('/send-reminders', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_MANAGE)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const due = await prisma.followUp.findMany({
      where: { clinicId, status: 'PENDING', dueDate: { gte: now, lte: tomorrow }, reminderSentAt: null },
      include: { doctor: { select: { name: true } } },
    });

    for (const f of due) {
      await notificationService.notifyPatient(f.patientId, {
        clinicId,
        type: NOTIFICATION_TYPE.FOLLOW_UP_REMINDER,
        title: 'Follow-up reminder',
        body: `Your follow-up with Dr. ${f.doctor.name} is scheduled for tomorrow.`,
        entityType: 'FollowUp',
        entityId: f.id,
      });
      await prisma.followUp.update({ where: { id: f.id }, data: { reminderSentAt: new Date() } });
    }
    return reply.send({ sent: due.length });
  });
}
