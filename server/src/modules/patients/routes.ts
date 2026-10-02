import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION, BLOOD_GROUPS, GENDER, RELATION } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { nextPatientCode } from './service.js';

const createPatientSchema = z.object({
  clinicId: z.string().min(1).max(64).optional(),
  userId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(160),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(GENDER).optional(),
  mobile: z.string().max(30).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  emergencyContact: z.string().max(60).optional(),
  bloodGroup: z.enum(BLOOD_GROUPS).optional(),
  allergies: z.string().max(1000).optional(),
  existingConditions: z.string().max(2000).optional(),
  medicalHistory: z.string().max(4000).optional(),
  currentMedications: z.string().max(2000).optional(),
});

const updatePatientSchema = createPatientSchema.partial().omit({ clinicId: true, userId: true });

export async function patientRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      search: z.string().max(120).optional(),
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
    }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    const where: Record<string, unknown> = { clinicId, isActive: true };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search } },
        { patientCode: { contains: q.search } },
        { mobile: { contains: q.search } },
      ];
    }

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const [items, total] = await Promise.all([
      prisma.patient.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.patient.count({ where }),
    ]);
    return reply.send({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_CREATE)] }, async (req, reply) => {
    const body = parseBody(req, createPatientSchema);
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    if (body.userId) {
      const linked = await prisma.patient.findUnique({ where: { userId: body.userId } });
      if (linked) throw AppError.conflict('This user account is already linked to a patient');
    }

    const patientCode = await nextPatientCode(clinicId);
    const patient = await prisma.patient.create({
      data: { ...body, clinicId, patientCode },
    });

    await recordAudit({
      action: AUDIT_ACTION.PATIENT_CREATED, entityType: 'Patient', entityId: patient.id,
      clinicId, userId: req.auth!.userId, metadata: { patientCode }, req,
    });
    return reply.code(201).send({ patient });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPatientAccess(req.auth, id);
    const patient = await prisma.patient.findUnique({
      where: { id },
      include: {
        asPrimary: { include: { member: true } },
        asMember: { include: { primary: true } },
      },
    });
    if (!patient) throw AppError.notFound('Patient not found');
    return reply.send({ patient });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_UPDATE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPatientAccess(req.auth, id, { write: true });
    const body = parseBody(req, updatePatientSchema);
    const patient = await prisma.patient.update({ where: { id }, data: body });
    await recordAudit({
      action: AUDIT_ACTION.PATIENT_UPDATED, entityType: 'Patient', entityId: id,
      clinicId: patient.clinicId, userId: req.auth!.userId, metadata: { fields: Object.keys(body) }, req,
    });
    return reply.send({ patient });
  });

  // Full clinical history bundle for the consultation screen.
  app.get('/:id/history', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPatientAccess(req.auth, id);

    const [consultations, prescriptions, vitals, documents, appointments] = await Promise.all([
      prisma.consultation.findMany({
        where: { patientId: id },
        include: { diagnoses: true, doctor: { select: { id: true, name: true, specialization: true } } },
        orderBy: { startedAt: 'desc' },
        take: 30,
      }),
      prisma.prescription.findMany({
        where: { patientId: id },
        include: {
          doctor: { select: { id: true, name: true, specialization: true } },
          versions: { orderBy: { version: 'desc' }, take: 1, include: { medicines: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.vital.findMany({ where: { patientId: id }, orderBy: { recordedAt: 'desc' }, take: 30 }),
      prisma.medicalDocument.findMany({
        where: { patientId: id },
        select: { id: true, title: true, category: true, fileName: true, mimeType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.appointment.findMany({
        where: { patientId: id },
        include: { doctor: { select: { id: true, name: true } } },
        orderBy: { scheduledAt: 'desc' },
        take: 30,
      }),
    ]);

    return reply.send({ consultations, prescriptions, vitals, documents, appointments });
  });

  // --- Family members ---
  app.get('/:id/family', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPatientAccess(req.auth, id);
    const links = await prisma.patientFamily.findMany({
      where: { primaryPatientId: id },
      include: { member: { select: { id: true, name: true, patientCode: true, dateOfBirth: true, gender: true, mobile: true } } },
    });
    return reply.send({ family: links });
  });

  app.post('/:id/family', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_FAMILY_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPatientAccess(req.auth, id, { write: true });
    const body = parseBody(req, z.object({
      memberPatientId: z.string().min(1).max(64),
      relation: z.enum(RELATION),
      canViewRecords: z.boolean().default(false),
    }));
    if (body.memberPatientId === id) throw AppError.badRequest('A patient cannot be their own family member');

    const member = await prisma.patient.findUnique({ where: { id: body.memberPatientId } });
    if (!member) throw AppError.notFound('Family member patient not found');

    const link = await prisma.patientFamily.upsert({
      where: { primaryPatientId_memberPatientId: { primaryPatientId: id, memberPatientId: body.memberPatientId } },
      create: { primaryPatientId: id, ...body },
      update: { relation: body.relation, canViewRecords: body.canViewRecords },
    });
    return reply.code(201).send({ link });
  });

  app.delete('/:id/family/:memberPatientId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PATIENT_FAMILY_MANAGE)] }, async (req, reply) => {
    const { id, memberPatientId } = parseParams(req, z.object({ id: z.string().min(1), memberPatientId: z.string().min(1) }));
    await assertPatientAccess(req.auth, id, { write: true });
    await prisma.patientFamily.deleteMany({ where: { primaryPatientId: id, memberPatientId } });
    return reply.send({ success: true });
  });
}
