import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { QUEUE_STATUS, NOTIFICATION_TYPE, APPOINTMENT_STATUS } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';
import { toDateKey } from '../../shared/utils.js';

export async function queueRoutes(app: FastifyInstance) {
  // Today's queue (or for a given date / doctor).
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      doctorId: z.string().optional(),
      date: z.string().optional(),
    }));

    // A patient sees only their own token.
    if (req.auth!.clinicIds.length === 0 && req.auth!.patientIds.length > 0) {
      const tokens = await prisma.queueToken.findMany({
        where: { patientId: { in: req.auth!.patientIds }, queueDate: q.date ?? toDateKey() },
        include: { doctor: { select: { id: true, name: true } } },
      });
      return reply.send({ tokens });
    }

    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const queueDate = q.date ?? toDateKey();

    const tokens = await prisma.queueToken.findMany({
      where: { clinicId, queueDate, ...(q.doctorId ? { doctorId: q.doctorId } : {}) },
      include: {
        patient: { select: { id: true, name: true, patientCode: true, mobile: true } },
        doctor: { select: { id: true, name: true } },
      },
      orderBy: [{ doctorId: 'asc' }, { tokenNumber: 'asc' }],
    });

    // Current token per doctor = first CONSULTING token, else first WAITING.
    const currentByDoctor: Record<string, string | null> = {};
    for (const t of tokens) {
      if (t.status === QUEUE_STATUS.CONSULTING) currentByDoctor[t.doctorId] = t.id;
      else if (!currentByDoctor[t.doctorId] && t.status === QUEUE_STATUS.WAITING) currentByDoctor[t.doctorId] = currentByDoctor[t.doctorId] ?? null;
    }

    return reply.send({ date: queueDate, tokens, currentByDoctor });
  });

  // Create a token. Optionally links an appointment and marks it checked-in.
  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().min(1).max(64).optional(),
      patientId: z.string().min(1).max(64),
      doctorId: z.string().min(1).max(64),
      appointmentId: z.string().min(1).max(64).optional(),
      notes: z.string().max(500).optional(),
    }));
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);

    const queueDate = toDateKey();
    const doctor = await prisma.doctor.findUnique({ where: { id: body.doctorId }, select: { id: true, name: true, clinicId: true } });
    if (!doctor || doctor.clinicId !== clinicId) throw AppError.badRequest('Doctor does not belong to this clinic');

    if (body.appointmentId) {
      const existing = await prisma.queueToken.findUnique({ where: { appointmentId: body.appointmentId } });
      if (existing) throw AppError.conflict('A token already exists for this appointment');
    }

    const last = await prisma.queueToken.findFirst({
      where: { clinicId, doctorId: body.doctorId, queueDate },
      orderBy: { tokenNumber: 'desc' },
    });
    const tokenNumber = (last?.tokenNumber ?? 0) + 1;

    const token = await prisma.queueToken.create({
      data: {
        clinicId,
        patientId: body.patientId,
        doctorId: body.doctorId,
        appointmentId: body.appointmentId,
        tokenNumber,
        queueDate,
        status: QUEUE_STATUS.WAITING,
        notes: body.notes,
      },
      include: { patient: { select: { id: true, name: true, patientCode: true } }, doctor: { select: { id: true, name: true } } },
    });

    if (body.appointmentId) {
      await prisma.appointment.update({ where: { id: body.appointmentId }, data: { status: APPOINTMENT_STATUS.CHECKED_IN } });
    }

    await notificationService.notifyPatient(body.patientId, {
      clinicId,
      type: NOTIFICATION_TYPE.TOKEN_CALLED,
      title: `Token ${String(tokenNumber).padStart(2, '0')} issued`,
      body: `You are in the queue for Dr. ${doctor.name}. Token ${String(tokenNumber).padStart(2, '0')}.`,
      entityType: 'QueueToken',
      entityId: token.id,
    });

    return reply.code(201).send({ token });
  });

  const transition = (allowedFrom: string[], to: string) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = parseParams(req, idParamSchema);
      const token = await prisma.queueToken.findUnique({ where: { id }, include: { doctor: { select: { name: true } } } });
      if (!token) throw AppError.notFound('Token not found');
      assertClinicAccess(req.auth, token.clinicId);
      if (!allowedFrom.includes(token.status)) {
        throw AppError.conflict(`Cannot move a ${token.status.toLowerCase()} token to ${to.toLowerCase()}`);
      }
      const updated = await prisma.queueToken.update({
        where: { id },
        data: {
          status: to,
          ...(to === QUEUE_STATUS.CONSULTING ? { calledAt: new Date() } : {}),
          ...(to === QUEUE_STATUS.COMPLETED ? { completedAt: new Date() } : {}),
        },
      });
      if (to === QUEUE_STATUS.CONSULTING) {
        await notificationService.notifyPatient(token.patientId, {
          clinicId: token.clinicId,
          type: NOTIFICATION_TYPE.TOKEN_CALLED,
          title: `It's your turn`,
          body: `Token ${String(token.tokenNumber).padStart(2, '0')} — please proceed to Dr. ${token.doctor.name}.`,
          entityType: 'QueueToken',
          entityId: id,
        });
      }
      return reply.send({ token: updated });
    };

  app.post('/:id/call', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, transition([QUEUE_STATUS.WAITING, QUEUE_STATUS.RECALLED, QUEUE_STATUS.SKIPPED], QUEUE_STATUS.CONSULTING));
  app.post('/:id/complete', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, transition([QUEUE_STATUS.CONSULTING, QUEUE_STATUS.WAITING], QUEUE_STATUS.COMPLETED));
  app.post('/:id/skip', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, transition([QUEUE_STATUS.WAITING, QUEUE_STATUS.RECALLED], QUEUE_STATUS.SKIPPED));
  app.post('/:id/recall', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, transition([QUEUE_STATUS.SKIPPED], QUEUE_STATUS.RECALLED));
  app.post('/:id/cancel', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_MANAGE)] }, transition([QUEUE_STATUS.WAITING, QUEUE_STATUS.RECALLED, QUEUE_STATUS.SKIPPED], QUEUE_STATUS.CANCELLED));

  // Waiting position for a specific token (approximate, derived from live queue).
  app.get('/:id/position', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.QUEUE_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const token = await prisma.queueToken.findUnique({ where: { id } });
    if (!token) throw AppError.notFound('Token not found');
    await assertPatientAccess(req.auth, token.patientId);

    const waiting = await prisma.queueToken.count({
      where: { doctorId: token.doctorId, queueDate: token.queueDate, status: QUEUE_STATUS.WAITING, tokenNumber: { lt: token.tokenNumber } },
    });
    const consulting = await prisma.queueToken.findFirst({
      where: { doctorId: token.doctorId, queueDate: token.queueDate, status: QUEUE_STATUS.CONSULTING },
      orderBy: { tokenNumber: 'asc' },
    });

    return reply.send({
      tokenNumber: token.tokenNumber,
      status: token.status,
      currentTokenNumber: consulting?.tokenNumber ?? null,
      // Position is an estimate only — not a promise of exact waiting time.
      approximatePosition: waiting + 1,
      isEstimate: true,
    });
  });
}
