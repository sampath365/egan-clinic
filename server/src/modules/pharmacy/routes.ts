import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import {
  AUDIT_ACTION, NOTIFICATION_TYPE, PHARMACY_PRESCRIPTION_STATUS, PHARMACY_TRANSITIONS,
  type PharmacyPrescriptionStatus,
} from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPharmacyAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';
import { isMedicalShopEnabled } from '../clinic/service.js';

// ---------------------------------------------------------------- /pharmacies

export async function pharmacyRoutes(app: FastifyInstance) {
  // Eligible pharmacies for patient selection (external, EGAN-participating).
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), eligible: z.coerce.boolean().optional() }));

    if (q.eligible) {
      const pharmacies = await prisma.pharmacy.findMany({
        where: { isActive: true, type: { in: ['EXTERNAL', 'EGAN'] } },
        select: { id: true, name: true, type: true, phone: true, address: true, isEganParticipating: true },
        orderBy: { name: 'asc' },
      });
      return reply.send({ pharmacies });
    }

    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const pharmacies = await prisma.pharmacy.findMany({
      where: { OR: [{ clinicId }, { type: { in: ['EXTERNAL', 'EGAN'] } }], isActive: true },
      orderBy: { name: 'asc' },
    });
    return reply.send({ pharmacies });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().max(64).optional(),
      name: z.string().min(1).max(160),
      type: z.enum(['ATTACHED', 'EXTERNAL', 'EGAN']).default('ATTACHED'),
      phone: z.string().max(30).optional(),
      email: z.string().email().optional(),
      address: z.string().max(500).optional(),
      licenseNo: z.string().max(80).optional(),
      isEganParticipating: z.boolean().optional(),
    }));

    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    if (body.type === 'ATTACHED') {
      if (!(await isMedicalShopEnabled(clinicId))) {
        throw AppError.conflict('Enable the medical shop module before adding an attached medical shop');
      }
      const existing = await prisma.pharmacy.findFirst({ where: { clinicId, type: 'ATTACHED' } });
      if (existing) throw AppError.conflict('This clinic already has an attached medical shop');
    }

    const pharmacy = await prisma.pharmacy.create({
      data: {
        name: body.name, type: body.type, phone: body.phone, email: body.email,
        address: body.address, licenseNo: body.licenseNo,
        isEganParticipating: body.isEganParticipating ?? body.type !== 'ATTACHED',
        clinicId: body.type === 'ATTACHED' ? clinicId : null,
      },
    });
    await recordAudit({ action: 'PHARMACY_CREATED', entityType: 'Pharmacy', entityId: pharmacy.id, clinicId, userId: req.auth!.userId, req });
    return reply.code(201).send({ pharmacy });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id }, include: { users: { include: { user: { select: { id: true, fullName: true, email: true } } } } } });
    if (!pharmacy) throw AppError.notFound('Pharmacy not found');
    if (pharmacy.clinicId) assertClinicAccess(req.auth, pharmacy.clinicId);
    else assertPharmacyAccess(req.auth, id);
    return reply.send({ pharmacy });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
    if (!pharmacy) throw AppError.notFound('Pharmacy not found');
    if (pharmacy.clinicId) assertClinicAccess(req.auth, pharmacy.clinicId);
    const body = parseBody(req, z.object({
      name: z.string().min(1).max(160).optional(),
      phone: z.string().max(30).optional(),
      email: z.string().email().optional(),
      address: z.string().max(500).optional(),
      licenseNo: z.string().max(80).optional(),
      isActive: z.boolean().optional(),
      isEganParticipating: z.boolean().optional(),
    }));
    const updated = await prisma.pharmacy.update({ where: { id }, data: body });
    return reply.send({ pharmacy: updated });
  });

  // Assign a pharmacist user to the pharmacy.
  app.post('/:id/users', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const pharmacy = await prisma.pharmacy.findUnique({ where: { id } });
    if (!pharmacy) throw AppError.notFound('Pharmacy not found');
    if (pharmacy.clinicId) assertClinicAccess(req.auth, pharmacy.clinicId);
    const body = parseBody(req, z.object({
      userId: z.string().min(1).max(64),
      role: z.enum(['PHARMACIST', 'MANAGER', 'STAFF']).default('PHARMACIST'),
    }));
    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) throw AppError.notFound('User not found');

    await prisma.pharmacyUser.upsert({
      where: { pharmacyId_userId: { pharmacyId: id, userId: body.userId } },
      create: { pharmacyId: id, userId: body.userId, role: body.role },
      update: { role: body.role, isActive: true },
    });
    const role = await prisma.role.upsert({ where: { name: 'PHARMACIST' }, create: { name: 'PHARMACIST', isSystem: true }, update: {} });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: body.userId, roleId: role.id } },
      create: { userId: body.userId, roleId: role.id },
      update: {},
    });
    return reply.code(201).send({ success: true });
  });

  // Pharmacy view of prescriptions shared with it.
  app.get('/:id/prescriptions', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertPharmacyAccess(req.auth, id);
    const rows = await prisma.pharmacyPrescription.findMany({
      where: { pharmacyId: id },
      include: {
        prescription: {
          include: {
            patient: { select: { id: true, name: true, patientCode: true } },
            doctor: { select: { id: true, name: true } },
            versions: { orderBy: { version: 'desc' }, take: 1, include: { medicines: true } },
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
    });
    return reply.send({ items: rows });
  });
}

// ---------------------------------------------- /pharmacy-prescriptions

export async function pharmacyPrescriptionRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ pharmacyId: z.string().optional(), status: z.string().optional() }));
    const pharmacyIds = q.pharmacyId ? [q.pharmacyId] : req.auth!.pharmacyIds;
    if (pharmacyIds.length === 0) throw AppError.forbidden('You are not associated with a pharmacy');
    for (const pid of pharmacyIds) assertPharmacyAccess(req.auth, pid);

    const rows = await prisma.pharmacyPrescription.findMany({
      where: { pharmacyId: { in: pharmacyIds }, ...(q.status ? { status: q.status } : {}) },
      include: {
        prescription: {
          include: {
            patient: { select: { id: true, name: true, patientCode: true, allergies: true } },
            doctor: { select: { id: true, name: true } },
            versions: { orderBy: { version: 'desc' }, take: 1, include: { medicines: true } },
          },
        },
        pharmacy: { select: { id: true, name: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
    return reply.send({ items: rows });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const row = await prisma.pharmacyPrescription.findUnique({
      where: { id },
      include: {
        prescription: {
          include: {
            patient: { select: { id: true, name: true, patientCode: true, allergies: true, dateOfBirth: true, gender: true } },
            doctor: { select: { id: true, name: true, specialization: true, registrationNo: true } },
            clinic: { select: { id: true, name: true, address: true, phone: true } },
            versions: { orderBy: { version: 'desc' }, include: { medicines: true, notesList: true } },
          },
        },
        pharmacy: true,
      },
    });
    if (!row) throw AppError.notFound('Pharmacy prescription not found');
    assertPharmacyAccess(req.auth, row.pharmacyId);

    await recordAudit({
      action: AUDIT_ACTION.PHARMACY_ACCESSED_PRESCRIPTION, entityType: 'Prescription', entityId: row.prescriptionId,
      clinicId: row.prescription.clinicId, userId: req.auth!.userId, metadata: { pharmacyId: row.pharmacyId }, req,
    });
    return reply.send({ pharmacyPrescription: row });
  });

  // Pharmacist workflow transitions. A prescription is never auto-dispensed.
  app.post('/:id/status', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_PROCESS)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({
      status: z.enum(Object.values(PHARMACY_PRESCRIPTION_STATUS) as [string, ...string[]]),
      note: z.string().max(1000).optional(),
      rejectionReason: z.string().max(1000).optional(),
    }));

    const row = await prisma.pharmacyPrescription.findUnique({
      where: { id },
      include: {
        prescription: {
          select: {
            id: true,
            clinicId: true,
            patient: { select: { id: true, name: true, userId: true } },
            doctor: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!row) throw AppError.notFound('Pharmacy prescription not found');
    assertPharmacyAccess(req.auth, row.pharmacyId);

    const current = row.status as PharmacyPrescriptionStatus;
    const next = body.status as PharmacyPrescriptionStatus;
    if (!PHARMACY_TRANSITIONS[current]?.includes(next)) {
      throw AppError.conflict(`Cannot move a prescription from ${current} to ${next}`);
    }
    if (next === PHARMACY_PRESCRIPTION_STATUS.REJECTED && !body.rejectionReason) {
      throw AppError.badRequest('A rejection reason is required');
    }

    const updated = await prisma.pharmacyPrescription.update({
      where: { id },
      data: {
        status: next,
        reviewedByUserId: req.auth!.userId,
        reviewedAt: next === PHARMACY_PRESCRIPTION_STATUS.UNDER_REVIEW ? new Date() : row.reviewedAt,
        clarificationNote: next === PHARMACY_PRESCRIPTION_STATUS.CLARIFICATION_REQUIRED ? body.note : row.clarificationNote,
        rejectionReason: next === PHARMACY_PRESCRIPTION_STATUS.REJECTED ? body.rejectionReason : row.rejectionReason,
        readyAt: next === PHARMACY_PRESCRIPTION_STATUS.READY ? new Date() : row.readyAt,
        completedAt: next === PHARMACY_PRESCRIPTION_STATUS.COMPLETED ? new Date() : row.completedAt,
      },
    });

    // Notify the patient (and, on clarification, the doctor) as appropriate.
    if (next === PHARMACY_PRESCRIPTION_STATUS.READY) {
      await notificationService.notifyPatient(row.prescription.patient.id, {
        clinicId: row.prescription.clinicId,
        type: NOTIFICATION_TYPE.MEDICINE_READY,
        title: 'Medicines ready',
        body: 'Your medicines are ready for pickup at the medical shop.',
        entityType: 'PharmacyPrescription',
        entityId: id,
      });
    }
    if (next === PHARMACY_PRESCRIPTION_STATUS.CLARIFICATION_REQUIRED) {
      const doctorUser = await prisma.doctor.findFirst({ where: { name: row.prescription.doctor.name, clinicId: row.prescription.clinicId }, select: { userId: true } });
      if (doctorUser?.userId) {
        await notificationService.notify({
          userId: doctorUser.userId,
          clinicId: row.prescription.clinicId,
          type: NOTIFICATION_TYPE.PHARMACY_CLARIFICATION,
          title: 'Pharmacy clarification requested',
          body: body.note ?? 'The pharmacy has requested clarification on a prescription.',
          entityType: 'PharmacyPrescription',
          entityId: id,
        });
      }
    }

    await recordAudit({
      action: 'PHARMACY_STATUS_CHANGED', entityType: 'PharmacyPrescription', entityId: id,
      clinicId: row.prescription.clinicId, userId: req.auth!.userId,
      metadata: { from: current, to: next, note: body.note }, req,
    });

    return reply.send({ pharmacyPrescription: updated });
  });

  // Create an order from an accepted prescription. Stock is confirmed by the
  // pharmacy; availability is never assumed by the clinic side.
  app.post('/:id/order', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_PROCESS)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({
      fulfillment: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
      items: z.array(z.object({
        name: z.string().min(1).max(200),
        available: z.boolean().default(true),
        quantity: z.string().max(60).optional(),
        unitPrice: z.number().min(0).max(1_000_000).default(0),
      })).min(1).max(60),
      notes: z.string().max(1000).optional(),
    }));

    const row = await prisma.pharmacyPrescription.findUnique({ where: { id } });
    if (!row) throw AppError.notFound('Pharmacy prescription not found');
    assertPharmacyAccess(req.auth, row.pharmacyId);
    if (!['ACCEPTED', 'PROCESSING', 'READY'].includes(row.status)) {
      throw AppError.conflict('The prescription must be accepted before an order can be created');
    }
    const existing = await prisma.pharmacyOrder.findUnique({ where: { pharmacyPrescriptionId: id } });
    if (existing) throw AppError.conflict('An order already exists for this prescription');

    const available = body.items.filter((i) => i.available);
    const total = available.reduce((sum, i) => sum + i.unitPrice, 0);
    const order = await prisma.pharmacyOrder.create({
      data: {
        pharmacyId: row.pharmacyId,
        pharmacyPrescriptionId: id,
        patientId: (await prisma.prescription.findUnique({ where: { id: row.prescriptionId }, select: { patientId: true } }))!.patientId,
        fulfillment: body.fulfillment,
        itemsJson: JSON.stringify(body.items),
        totalAmount: total,
        notes: body.notes,
        status: 'PENDING',
      },
    });
    return reply.code(201).send({ order });
  });

  app.post('/:id/order/status', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PHARMACY_PRESCRIPTION_PROCESS)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({
      status: z.enum(['PENDING', 'CONFIRMED', 'PAID', 'READY', 'PICKED_UP', 'DELIVERED', 'CANCELLED']),
    }));
    const order = await prisma.pharmacyOrder.findFirst({ where: { pharmacyPrescriptionId: id } });
    if (!order) throw AppError.notFound('Order not found');
    assertPharmacyAccess(req.auth, order.pharmacyId);
    const updated = await prisma.pharmacyOrder.update({ where: { id: order.id }, data: { status: body.status } });
    return reply.send({ order: updated });
  });
}
