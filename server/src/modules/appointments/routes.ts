import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { APPOINTMENT_STATUS, APPOINTMENT_STATUSES, APPOINTMENT_TYPES, NOTIFICATION_TYPE } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertDoctorAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';
import { endOfDay, startOfDay } from '../../shared/utils.js';

const createSchema = z.object({
  clinicId: z.string().min(1).max(64).optional(),
  patientId: z.string().min(1).max(64),
  doctorId: z.string().min(1).max(64),
  scheduledAt: z.coerce.date(),
  durationMin: z.number().int().min(5).max(240).default(15),
  reason: z.string().max(500).optional(),
  type: z.enum(APPOINTMENT_TYPES).default('CONSULTATION'),
  source: z.enum(['ONLINE', 'RECEPTION', 'WALK_IN']).default('RECEPTION'),
  notes: z.string().max(1000).optional(),
});

const statusSchema = z.object({ status: z.enum(APPOINTMENT_STATUSES), notes: z.string().max(500).optional() });
const rescheduleSchema = z.object({ scheduledAt: z.coerce.date(), reason: z.string().max(500).optional() });

export async function appointmentRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      doctorId: z.string().optional(),
      patientId: z.string().optional(),
      date: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
    }));

    // Patients may only see their own appointments.
    const isPatientOnly = req.auth!.patientIds.length > 0 && req.auth!.clinicIds.length === 0;
    const where: Record<string, unknown> = {};
    if (isPatientOnly) {
      where.patientId = { in: req.auth!.patientIds };
    } else {
      const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
      assertClinicAccess(req.auth, clinicId);
      where.clinicId = clinicId;
    }
    if (q.doctorId) where.doctorId = q.doctorId;
    if (q.patientId) where.patientId = q.patientId;
    if (q.status) where.status = q.status;
    if (q.date) {
      const d = new Date(`${q.date}T00:00:00`);
      if (!Number.isNaN(d.getTime())) where.scheduledAt = { gte: startOfDay(d), lte: endOfDay(d) };
    }

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 50));
    const [items, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, patientCode: true, mobile: true, dateOfBirth: true, gender: true } },
          doctor: { select: { id: true, name: true, specialization: true } },
          queueToken: true,
        },
        orderBy: { scheduledAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.appointment.count({ where }),
    ]);
    return reply.send({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, createSchema);
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);
    await assertDoctorAccess(req.auth, body.doctorId);

    const patient = await prisma.patient.findUnique({ where: { id: body.patientId } });
    if (!patient || patient.clinicId !== clinicId) throw AppError.badRequest('Patient does not belong to this clinic');

    const appointment = await prisma.appointment.create({
      data: { ...body, clinicId, createdByUserId: req.auth!.userId, status: APPOINTMENT_STATUS.BOOKED },
      include: { doctor: { select: { name: true } } },
    });

    await notificationService.notifyPatient(body.patientId, {
      clinicId,
      type: NOTIFICATION_TYPE.APPOINTMENT_BOOKED,
      title: 'Appointment booked',
      body: `Your appointment with Dr. ${appointment.doctor.name} is booked for ${appointment.scheduledAt.toLocaleString()}.`,
      entityType: 'Appointment',
      entityId: appointment.id,
    });

    return reply.code(201).send({ appointment });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const appointment = await prisma.appointment.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, name: true, patientCode: true, mobile: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
        queueToken: true,
        consultation: true,
      },
    });
    if (!appointment) throw AppError.notFound('Appointment not found');
    await assertPatientAccess(req.auth, appointment.patientId);
    return reply.send({ appointment });
  });

  app.patch('/:id/status', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, statusSchema);
    const existing = await prisma.appointment.findUnique({ where: { id }, include: { doctor: { select: { name: true } } } });
    if (!existing) throw AppError.notFound('Appointment not found');
    assertClinicAccess(req.auth, existing.clinicId);

    const appointment = await prisma.appointment.update({ where: { id }, data: { status: body.status, notes: body.notes ?? existing.notes } });

    const typeMap: Record<string, string> = {
      CONFIRMED: NOTIFICATION_TYPE.APPOINTMENT_CONFIRMED,
      CANCELLED: NOTIFICATION_TYPE.APPOINTMENT_CANCELLED,
    };
    const notifyType = typeMap[body.status];
    if (notifyType) {
      await notificationService.notifyPatient(existing.patientId, {
        clinicId: existing.clinicId,
        type: notifyType as never,
        title: body.status === 'CONFIRMED' ? 'Appointment confirmed' : 'Appointment cancelled',
        body: `Your appointment with Dr. ${existing.doctor.name} on ${existing.scheduledAt.toLocaleString()} is now ${body.status.toLowerCase()}.`,
        entityType: 'Appointment',
        entityId: id,
      });
    }
    return reply.send({ appointment });
  });

  app.post('/:id/reschedule', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, rescheduleSchema);
    const existing = await prisma.appointment.findUnique({ where: { id }, include: { doctor: { select: { name: true } } } });
    if (!existing) throw AppError.notFound('Appointment not found');
    assertClinicAccess(req.auth, existing.clinicId);
    if (['COMPLETED', 'CANCELLED'].includes(existing.status)) {
      throw AppError.conflict(`Cannot reschedule an appointment that is ${existing.status.toLowerCase()}`);
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: { scheduledAt: body.scheduledAt, status: APPOINTMENT_STATUS.RESCHEDULED, notes: body.reason ?? existing.notes },
    });

    await notificationService.notifyPatient(existing.patientId, {
      clinicId: existing.clinicId,
      type: NOTIFICATION_TYPE.APPOINTMENT_CHANGED,
      title: 'Appointment rescheduled',
      body: `Your appointment with Dr. ${existing.doctor.name} has been moved to ${body.scheduledAt.toLocaleString()}.`,
      entityType: 'Appointment',
      entityId: id,
    });
    return reply.send({ appointment });
  });

  app.delete('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.APPOINTMENT_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.appointment.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Appointment not found');
    assertClinicAccess(req.auth, existing.clinicId);
    const appointment = await prisma.appointment.update({ where: { id }, data: { status: APPOINTMENT_STATUS.CANCELLED } });
    await notificationService.notifyPatient(existing.patientId, {
      clinicId: existing.clinicId,
      type: NOTIFICATION_TYPE.APPOINTMENT_CANCELLED,
      title: 'Appointment cancelled',
      body: `Your appointment on ${existing.scheduledAt.toLocaleString()} has been cancelled.`,
      entityType: 'Appointment',
      entityId: id,
    });
    await recordAudit({ action: 'APPOINTMENT_CANCELLED', entityType: 'Appointment', entityId: id, clinicId: existing.clinicId, userId: req.auth!.userId, req });
    return reply.send({ appointment });
  });
}
