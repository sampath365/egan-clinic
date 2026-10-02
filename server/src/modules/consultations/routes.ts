import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION, INVESTIGATION_TYPE, APPOINTMENT_STATUS, QUEUE_STATUS } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { computeBmi } from './service.js';

const vitalsSchema = z.object({
  temperature: z.number().min(20).max(45).optional(),
  bpSystolic: z.number().int().min(40).max(300).optional(),
  bpDiastolic: z.number().int().min(20).max(200).optional(),
  pulse: z.number().int().min(20).max(300).optional(),
  spo2: z.number().int().min(30).max(100).optional(),
  weightKg: z.number().min(0.3).max(500).optional(),
  heightCm: z.number().min(20).max(300).optional(),
  respiratoryRate: z.number().int().min(4).max(80).optional(),
  extraJson: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  recordedAt: z.coerce.date().optional(),
});

const createSchema = z.object({
  clinicId: z.string().min(1).max(64).optional(),
  patientId: z.string().min(1).max(64),
  doctorId: z.string().min(1).max(64),
  appointmentId: z.string().min(1).max(64).optional(),
  chiefComplaint: z.string().max(2000).optional(),
  symptoms: z.string().max(4000).optional(),
  history: z.string().max(4000).optional(),
  examination: z.string().max(4000).optional(),
  diagnosis: z.string().max(2000).optional(),
  doctorNotes: z.string().max(8000).optional(),
  advice: z.string().max(4000).optional(),
  followUpDate: z.coerce.date().optional(),
});

const updateSchema = createSchema.partial().omit({ clinicId: true, patientId: true, doctorId: true, appointmentId: true });

export async function consultationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      patientId: z.string().optional(),
      doctorId: z.string().optional(),
      status: z.string().optional(),
    }));
    const where: Record<string, unknown> = {};
    if (req.auth!.clinicIds.length === 0 && req.auth!.patientIds.length > 0) {
      where.patientId = { in: req.auth!.patientIds };
    } else {
      const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
      assertClinicAccess(req.auth, clinicId);
      where.clinicId = clinicId;
    }
    if (q.patientId) where.patientId = q.patientId;
    if (q.doctorId) where.doctorId = q.doctorId;
    if (q.status) where.status = q.status;

    const consultations = await prisma.consultation.findMany({
      where,
      include: {
        patient: { select: { id: true, name: true, patientCode: true } },
        doctor: { select: { id: true, name: true, specialization: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    return reply.send({ consultations });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, createSchema);
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);

    const consultation = await prisma.consultation.create({
      data: { ...body, clinicId, status: 'IN_PROGRESS' },
    });

    // Mark the linked appointment / queue token as in consultation.
    if (body.appointmentId) {
      await prisma.appointment.update({ where: { id: body.appointmentId }, data: { status: APPOINTMENT_STATUS.IN_CONSULTATION } }).catch(() => undefined);
    }
    await prisma.queueToken.updateMany({
      where: { patientId: body.patientId, doctorId: body.doctorId, status: QUEUE_STATUS.CONSULTING },
      data: {},
    });

    await recordAudit({
      action: AUDIT_ACTION.CONSULTATION_CREATED, entityType: 'Consultation', entityId: consultation.id,
      clinicId, userId: req.auth!.userId, req,
    });
    return reply.code(201).send({ consultation });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const consultation = await prisma.consultation.findUnique({
      where: { id },
      include: {
        patient: true,
        doctor: { select: { id: true, name: true, specialization: true, qualification: true, registrationNo: true } },
        vitals: { orderBy: { recordedAt: 'desc' } },
        diagnoses: true,
        investigations: true,
        procedures: true,
        prescriptions: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
        followUps: true,
      },
    });
    if (!consultation) throw AppError.notFound('Consultation not found');
    await assertPatientAccess(req.auth, consultation.patientId);
    return reply.send({ consultation });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.consultation.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, existing.clinicId);
    if (existing.status === 'COMPLETED') throw AppError.conflict('A completed consultation cannot be edited');
    const body = parseBody(req, updateSchema);
    const consultation = await prisma.consultation.update({ where: { id }, data: body });
    return reply.send({ consultation });
  });

  app.post('/:id/complete', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const existing = await prisma.consultation.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, existing.clinicId);

    const consultation = await prisma.consultation.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (existing.appointmentId) {
      await prisma.appointment.update({ where: { id: existing.appointmentId }, data: { status: APPOINTMENT_STATUS.COMPLETED } }).catch(() => undefined);
    }
    await prisma.queueToken.updateMany({
      where: { patientId: existing.patientId, doctorId: existing.doctorId, status: QUEUE_STATUS.CONSULTING },
      data: { status: QUEUE_STATUS.COMPLETED, completedAt: new Date() },
    });
    return reply.send({ consultation });
  });

  // --- Vitals ---
  app.post('/:id/vitals', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.VITALS_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    const body = parseBody(req, vitalsSchema);

    const bmi = computeBmi(body.weightKg, body.heightCm);
    const vital = await prisma.vital.create({
      data: {
        clinicId: consultation.clinicId,
        patientId: consultation.patientId,
        consultationId: id,
        recordedByUserId: req.auth!.userId,
        ...body,
        extraJson: body.extraJson ? JSON.stringify(body.extraJson) : null,
        bmi,
      },
    });
    return reply.code(201).send({ vital });
  });

  // --- Diagnoses ---
  app.post('/:id/diagnoses', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    const body = parseBody(req, z.object({
      code: z.string().max(20).optional(),
      description: z.string().min(1).max(300),
      type: z.enum(['PRIMARY', 'SECONDARY', 'PROVISIONAL']).default('PRIMARY'),
      notes: z.string().max(1000).optional(),
    }));
    const diagnosis = await prisma.diagnosis.create({ data: { consultationId: id, ...body } });
    return reply.code(201).send({ diagnosis });
  });

  app.delete('/:id/diagnoses/:diagnosisId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id, diagnosisId } = parseParams(req, z.object({ id: z.string(), diagnosisId: z.string() }));
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    await prisma.diagnosis.deleteMany({ where: { id: diagnosisId, consultationId: id } });
    return reply.send({ success: true });
  });

  // --- Investigations ---
  app.post('/:id/investigations', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    const body = parseBody(req, z.object({
      type: z.enum(INVESTIGATION_TYPE).default('LAB'),
      name: z.string().min(1).max(200),
      instructions: z.string().max(1000).optional(),
    }));
    const investigation = await prisma.investigation.create({ data: { consultationId: id, ...body } });
    return reply.code(201).send({ investigation });
  });

  app.patch('/:id/investigations/:investigationId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id, investigationId } = parseParams(req, z.object({ id: z.string(), investigationId: z.string() }));
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    const body = parseBody(req, z.object({
      status: z.enum(['ORDERED', 'COMPLETED', 'CANCELLED']).optional(),
      resultSummary: z.string().max(2000).optional(),
    }));
    const investigation = await prisma.investigation.update({ where: { id: investigationId }, data: body });
    return reply.send({ investigation });
  });

  // --- Procedures ---
  app.post('/:id/procedures', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CONSULTATION_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const consultation = await prisma.consultation.findUnique({ where: { id } });
    if (!consultation) throw AppError.notFound('Consultation not found');
    assertClinicAccess(req.auth, consultation.clinicId);
    const body = parseBody(req, z.object({
      name: z.string().min(1).max(200),
      notes: z.string().max(1000).optional(),
      fee: z.number().min(0).max(1_000_000).default(0),
    }));
    const procedure = await prisma.procedure.create({ data: { consultationId: id, ...body } });
    return reply.code(201).send({ procedure });
  });
}
