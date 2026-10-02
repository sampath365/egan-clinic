import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import {
  AUDIT_ACTION, FOOD_RELATION, MEDICINE_FORM, MEDICINE_ROUTE,
  NOTIFICATION_TYPE, PRESCRIPTION_STATUS, PRESCRIPTION_VERSION_STATUS, PHARMACY_PRESCRIPTION_STATUS,
} from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, assertPrescriptionAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';
import { isMedicalShopEnabled } from '../clinic/service.js';
import { nextPrescriptionNo } from '../patients/service.js';
import {
  assertPrescriptionMutable, assertVersionEditable, computeContentHash, currentVersion,
  generateAndStorePdf, loadPrescription, readFileBuffer, writeFileBuffer,
} from './service.js';
import { config } from '../../shared/config.js';

const medicineSchema = z.object({
  medicineId: z.string().max(64).nullish(),
  name: z.string().min(1).max(200),
  genericName: z.string().max(200).nullish(),
  strength: z.string().max(60).nullish(),
  form: z.enum(MEDICINE_FORM).nullish(),
  dose: z.string().max(80).nullish(),
  frequency: z.string().max(80).nullish(),
  route: z.enum(MEDICINE_ROUTE).nullish(),
  duration: z.string().max(80).nullish(),
  instructions: z.string().max(300).nullish(),
  foodRelation: z.enum(FOOD_RELATION).nullish(),
  quantity: z.string().max(60).nullish(),
  isControlled: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const contentSchema = z.object({
  diagnosis: z.string().max(2000).nullish(),
  notes: z.string().max(8000).nullish(),
  advice: z.string().max(4000).nullish(),
  followUpDate: z.coerce.date().nullish(),
  inkStrokesJson: z.string().max(2_000_000).nullish(),
  voiceTranscript: z.string().max(20000).nullish(),
  medicines: z.array(medicineSchema).max(60).optional(),
  notesList: z.array(z.object({ type: z.string().max(40).optional(), text: z.string().min(1).max(2000) })).max(40).optional(),
  attachmentDocumentIds: z.array(z.string().max(64)).max(20).optional(),
  status: z.enum(['DRAFT', 'REVIEW']).optional(),
});

function ageFromDob(dob: Date | null | undefined): string | null {
  if (!dob) return null;
  const diff = Date.now() - dob.getTime();
  const years = Math.floor(diff / (365.25 * 24 * 3600 * 1000));
  return `${years} yrs`;
}

export async function prescriptionRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ list
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(),
      patientId: z.string().optional(),
      doctorId: z.string().optional(),
      status: z.string().optional(),
      page: z.coerce.number().optional(),
      pageSize: z.coerce.number().optional(),
    }));

    const where: Record<string, unknown> = {};
    if (req.auth!.clinicIds.length === 0 && req.auth!.patientIds.length > 0) {
      where.patientId = { in: req.auth!.patientIds };
    } else if (req.auth!.pharmacyIds.length > 0 && req.auth!.clinicIds.length === 0) {
      // Pharmacists only see prescriptions explicitly shared with their pharmacy.
      where.shares = { some: { pharmacyId: { in: req.auth!.pharmacyIds } } };
    } else {
      const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
      assertClinicAccess(req.auth, clinicId);
      where.clinicId = clinicId;
    }
    if (q.patientId) where.patientId = q.patientId;
    if (q.doctorId) where.doctorId = q.doctorId;
    if (q.status) where.status = q.status;

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const [items, total] = await Promise.all([
      prisma.prescription.findMany({
        where,
        include: {
          patient: { select: { id: true, name: true, patientCode: true } },
          doctor: { select: { id: true, name: true, specialization: true } },
          versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true, issuedAt: true } },
          _count: { select: { versions: true, shares: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.prescription.count({ where }),
    ]);
    return reply.send({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  });

  // --------------------------------------------------------------- create
  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_CREATE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().max(64).optional(),
      patientId: z.string().min(1).max(64),
      doctorId: z.string().min(1).max(64),
      consultationId: z.string().max(64).optional(),
    }));
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);

    const prescriptionNo = await nextPrescriptionNo(clinicId);
    const prescription = await prisma.prescription.create({
      data: {
        clinicId,
        patientId: body.patientId,
        doctorId: body.doctorId,
        consultationId: body.consultationId,
        prescriptionNo,
        status: PRESCRIPTION_STATUS.DRAFT,
        versions: { create: { version: 1, status: PRESCRIPTION_VERSION_STATUS.DRAFT } },
      },
      include: { versions: true },
    });
    await prisma.prescription.update({
      where: { id: prescription.id },
      data: { currentVersionId: prescription.versions[0]!.id },
    });

    await recordAudit({
      action: AUDIT_ACTION.PRESCRIPTION_CREATED, entityType: 'Prescription', entityId: prescription.id,
      clinicId, userId: req.auth!.userId, metadata: { prescriptionNo }, req,
    });
    return reply.code(201).send({ prescription: await loadPrescription(prescription.id) });
  });

  // ------------------------------------------------------------------ get
  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    const rx = await loadPrescription(id);

    // Viewing a shared prescription is audited for both pharmacy and patient.
    const isPharmacy = req.auth!.pharmacyIds.length > 0 && req.auth!.clinicIds.length === 0;
    if (isPharmacy) {
      await recordAudit({
        action: AUDIT_ACTION.PHARMACY_ACCESSED_PRESCRIPTION, entityType: 'Prescription', entityId: id,
        clinicId: scope.clinicId, userId: req.auth!.userId, req,
      });
    } else if (req.auth!.patientIds.includes(scope.patientId)) {
      await recordAudit({
        action: AUDIT_ACTION.PRESCRIPTION_VIEWED, entityType: 'Prescription', entityId: id,
        clinicId: scope.clinicId, userId: req.auth!.userId, req,
      });
      if (rx.status === PRESCRIPTION_STATUS.SHARED) {
        await prisma.prescription.update({ where: { id }, data: { status: PRESCRIPTION_STATUS.VIEWED } });
      }
      await prisma.prescriptionShare.updateMany({
        where: { prescriptionId: id, patientId: scope.patientId, viewedAt: null },
        data: { viewedAt: new Date() },
      });
    }
    return reply.send({ prescription: rx, currentVersion: currentVersion(rx.versions) });
  });

  // -------------------------------------------- update draft/review version
  app.put('/:id/content', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_CREATE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const body = parseBody(req, contentSchema);
    const rx = await loadPrescription(id);
    assertPrescriptionMutable(rx.status);
    const target = rx.versions.find((v) => v.status === PRESCRIPTION_VERSION_STATUS.DRAFT || v.status === PRESCRIPTION_VERSION_STATUS.REVIEW)
      ?? rx.versions[0];
    if (!target) throw AppError.notFound('No editable version found');
    assertVersionEditable(target.status);

    await prisma.$transaction(async (tx) => {
      await tx.prescriptionVersion.update({
        where: { id: target.id },
        data: {
          diagnosis: body.diagnosis ?? target.diagnosis,
          notes: body.notes ?? target.notes,
          advice: body.advice ?? target.advice,
          followUpDate: body.followUpDate === undefined ? target.followUpDate : body.followUpDate,
          inkStrokesJson: body.inkStrokesJson === undefined ? target.inkStrokesJson : body.inkStrokesJson,
          voiceTranscript: body.voiceTranscript === undefined ? target.voiceTranscript : body.voiceTranscript,
          status: body.status ?? (target.status === PRESCRIPTION_VERSION_STATUS.DRAFT ? PRESCRIPTION_VERSION_STATUS.DRAFT : target.status),
        },
      });

      if (body.medicines) {
        await tx.prescriptionMedicine.deleteMany({ where: { versionId: target.id } });
        if (body.medicines.length > 0) {
          await tx.prescriptionMedicine.createMany({
            data: body.medicines.map((m, i) => ({
              versionId: target.id,
              medicineId: m.medicineId ?? null,
              name: m.name,
              genericName: m.genericName ?? null,
              strength: m.strength ?? null,
              form: m.form ?? null,
              dose: m.dose ?? null,
              frequency: m.frequency ?? null,
              route: m.route ?? null,
              duration: m.duration ?? null,
              instructions: m.instructions ?? null,
              foodRelation: m.foodRelation ?? null,
              quantity: m.quantity ?? null,
              isControlled: m.isControlled ?? false,
              sortOrder: m.sortOrder ?? i,
            })),
          });
        }
      }

      if (body.notesList) {
        await tx.prescriptionNote.deleteMany({ where: { versionId: target.id } });
        if (body.notesList.length > 0) {
          await tx.prescriptionNote.createMany({
            data: body.notesList.map((n) => ({ versionId: target.id, type: n.type ?? 'GENERAL', text: n.text })),
          });
        }
      }

      if (body.attachmentDocumentIds) {
        await tx.prescriptionAttachment.deleteMany({ where: { versionId: target.id } });
        if (body.attachmentDocumentIds.length > 0) {
          await tx.prescriptionAttachment.createMany({
            data: body.attachmentDocumentIds.map((docId) => ({ prescriptionId: id, versionId: target.id, medicalDocumentId: docId })),
          });
        }
      }
    });

    return reply.send({ prescription: await loadPrescription(id) });
  });

  // --------------------------------------------------------------- preview
  app.get('/:id/preview', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertPrescriptionAccess(req.auth, id);
    const rx = await loadPrescription(id);
    const version = currentVersion(rx.versions);
    return reply.send({
      prescription: {
        prescriptionNo: rx.prescriptionNo,
        status: rx.status,
        patient: rx.patient,
        doctor: {
          name: rx.doctor.name,
          qualification: rx.doctor.qualification,
          specialization: rx.doctor.specialization,
          registrationNo: rx.doctor.registrationNo,
        },
        clinic: { name: rx.clinic.name, address: rx.clinic.address, phone: rx.clinic.phone, email: rx.clinic.email },
        version: version?.version ?? 1,
        content: version,
        hasInk: Boolean(version?.inkStrokesJson || version?.inkImagePath),
        medicines: version?.medicines ?? [],
      },
    });
  });

  // ------------------------------------------------------------------ ink
  app.post('/:id/ink', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_CREATE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const rx = await loadPrescription(id);
    assertPrescriptionMutable(rx.status);
    const target = rx.versions[0];
    if (!target) throw AppError.notFound('No version found');
    assertVersionEditable(target.status);

    // Accepts a base64 data URL or raw base64 PNG of the rendered ink canvas.
    const body = parseBody(req, z.object({
      imageBase64: z.string().min(16).max(15_000_000),
      strokesJson: z.string().max(2_000_000).optional(),
    }));
    const base64 = body.imageBase64.includes(',') ? body.imageBase64.split(',')[1]! : body.imageBase64;
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) throw AppError.badRequest('Invalid ink image');

    const relPath = `prescriptions/${id}/v${target.version}-ink.png`;
    await writeFileBuffer(relPath, buffer);
    await prisma.prescriptionVersion.update({
      where: { id: target.id },
      data: { inkImagePath: relPath, inkStrokesJson: body.strokesJson ?? target.inkStrokesJson },
    });
    return reply.send({ success: true, inkImagePath: relPath });
  });

  // ----------------------------------------------------------------- issue
  app.post('/:id/issue', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_ISSUE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const rx = await loadPrescription(id);
    assertPrescriptionMutable(rx.status);
    if (rx.status === PRESCRIPTION_STATUS.ISSUED || rx.status === PRESCRIPTION_STATUS.SHARED || rx.status === PRESCRIPTION_STATUS.VIEWED) {
      throw AppError.conflict('This prescription has already been issued. Create a corrected version instead.');
    }

    const version = rx.versions[0];
    if (!version) throw AppError.notFound('No version to issue');
    assertVersionEditable(version.status);
    // A doctor must explicitly confirm; issuing an empty prescription is blocked.
    const hasContent = version.medicines.length > 0 || version.inkStrokesJson || version.inkImagePath || version.notesList.length > 0;
    if (!hasContent) {
      throw AppError.unprocessable('Add at least one medicine, note, or a handwritten prescription before issuing');
    }

    const contentHash = computeContentHash({
      diagnosis: version.diagnosis,
      notes: version.notes,
      advice: version.advice,
      followUpDate: version.followUpDate,
      inkStrokesJson: version.inkStrokesJson,
      inkImagePath: version.inkImagePath,
      voiceTranscript: version.voiceTranscript,
      medicines: version.medicines,
      notesList: version.notesList,
    });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.prescriptionVersion.update({
        where: { id: version.id },
        data: {
          status: PRESCRIPTION_VERSION_STATUS.ISSUED,
          issuedAt: now,
          issuedByUserId: req.auth!.userId,
          contentHash,
          signatureUrl: rx.doctor.digitalSignatureUrl,
        },
      });
      await tx.prescription.update({
        where: { id },
        data: { status: PRESCRIPTION_STATUS.ISSUED, issuedAt: now, currentVersionId: version.id },
      });
    });

    await recordAudit({
      action: AUDIT_ACTION.PRESCRIPTION_ISSUED, entityType: 'Prescription', entityId: id,
      clinicId: scope.clinicId, userId: req.auth!.userId,
      metadata: { version: version.version, contentHash, prescriptionNo: rx.prescriptionNo }, req,
    });

    return reply.send({ prescription: await loadPrescription(id) });
  });

  // ------------------------------------------------------- corrected version
  app.post('/:id/correct', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_CORRECT)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const rx = await loadPrescription(id);
    const latest = rx.versions[0];
    if (!latest) throw AppError.notFound('No version found');
    if (latest.status === PRESCRIPTION_VERSION_STATUS.DRAFT) {
      throw AppError.conflict('This prescription has not been issued yet');
    }

    const nextVersion = (rx.versions[0]?.version ?? 0) + 1;
    const created = await prisma.$transaction(async (tx) => {
      // Supersede the issued version rather than overwriting it.
      await tx.prescriptionVersion.update({
        where: { id: latest.id },
        data: { status: PRESCRIPTION_VERSION_STATUS.SUPERSEDED, supersededByVersion: nextVersion },
      });
      const v = await tx.prescriptionVersion.create({
        data: {
          prescriptionId: id,
          version: nextVersion,
          status: PRESCRIPTION_VERSION_STATUS.DRAFT,
          diagnosis: latest.diagnosis,
          notes: latest.notes,
          advice: latest.advice,
          followUpDate: latest.followUpDate,
          inkStrokesJson: latest.inkStrokesJson,
          inkImagePath: latest.inkImagePath,
          voiceTranscript: latest.voiceTranscript,
          medicines: {
            create: latest.medicines.map((m) => ({
              medicineId: m.medicineId, name: m.name, genericName: m.genericName, strength: m.strength,
              form: m.form, dose: m.dose, frequency: m.frequency, route: m.route, duration: m.duration,
              instructions: m.instructions, foodRelation: m.foodRelation, quantity: m.quantity,
              isControlled: m.isControlled, sortOrder: m.sortOrder,
            })),
          },
        },
      });
      await tx.prescription.update({
        where: { id },
        data: { status: PRESCRIPTION_STATUS.CORRECTED, currentVersionId: v.id },
      });
      return v;
    });

    await recordAudit({
      action: AUDIT_ACTION.PRESCRIPTION_CORRECTED, entityType: 'Prescription', entityId: id,
      clinicId: scope.clinicId, userId: req.auth!.userId,
      metadata: { fromVersion: latest.version, newVersion: created.version }, req,
    });

    return reply.code(201).send({ prescription: await loadPrescription(id) });
  });

  // ---------------------------------------------------------------- cancel
  app.post('/:id/cancel', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_CORRECT)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const rx = await loadPrescription(id);
    if (rx.status === PRESCRIPTION_STATUS.CANCELLED) throw AppError.conflict('Prescription is already cancelled');

    await prisma.$transaction(async (tx) => {
      await tx.prescription.update({ where: { id }, data: { status: PRESCRIPTION_STATUS.CANCELLED } });
      await tx.prescriptionVersion.updateMany({
        where: { prescriptionId: id, status: { in: [PRESCRIPTION_VERSION_STATUS.DRAFT, PRESCRIPTION_VERSION_STATUS.REVIEW] } },
        data: { status: PRESCRIPTION_VERSION_STATUS.CANCELLED },
      });
    });
    await recordAudit({
      action: 'PRESCRIPTION_CANCELLED', entityType: 'Prescription', entityId: id,
      clinicId: scope.clinicId, userId: req.auth!.userId, req,
    });
    return reply.send({ prescription: await loadPrescription(id) });
  });

  // ----------------------------------------------------------------- share
  app.post('/:id/share', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_SHARE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    assertClinicAccess(req.auth, scope.clinicId);
    const body = parseBody(req, z.object({
      targets: z.array(z.enum(['PATIENT', 'ATTACHED_PHARMACY', 'EXTERNAL_PHARMACY'])).min(1),
      pharmacyId: z.string().max(64).optional(),
      channel: z.enum(['IN_APP', 'PDF', 'WHATSAPP', 'EMAIL', 'SMS']).default('IN_APP'),
      patientConsent: z.boolean().optional(),
    }));

    const rx = await loadPrescription(id);
    if (![PRESCRIPTION_STATUS.ISSUED, PRESCRIPTION_STATUS.SHARED, PRESCRIPTION_STATUS.VIEWED, PRESCRIPTION_STATUS.CORRECTED].includes(rx.status as never)) {
      throw AppError.conflict('Issue the prescription before sharing it');
    }
    const version = currentVersion(rx.versions);
    const medicalShopEnabled = await isMedicalShopEnabled(scope.clinicId);
    const results: Array<{ target: string; ok: boolean; reason?: string }> = [];

    for (const target of body.targets) {
      if (target === 'PATIENT') {
        await prisma.prescriptionShare.create({
          data: { prescriptionId: id, versionId: version?.id, targetType: 'PATIENT', patientId: rx.patientId, channel: body.channel, sharedByUserId: req.auth!.userId },
        });
        await notificationService.notifyPatient(rx.patientId, {
          clinicId: scope.clinicId,
          type: NOTIFICATION_TYPE.PRESCRIPTION_ISSUED,
          title: 'Prescription available',
          body: `Dr. ${rx.doctor.name} has issued your prescription. Prescription No: ${rx.prescriptionNo}.`,
          entityType: 'Prescription',
          entityId: id,
        });
        await recordAudit({
          action: AUDIT_ACTION.PRESCRIPTION_SHARED, entityType: 'Prescription', entityId: id,
          clinicId: scope.clinicId, userId: req.auth!.userId, metadata: { target, channel: body.channel }, req,
        });
        results.push({ target, ok: true });
        continue;
      }

      if (!medicalShopEnabled) {
        results.push({ target, ok: false, reason: 'The medical shop module is disabled for this clinic' });
        continue;
      }

      let pharmacyId = body.pharmacyId;
      if (target === 'ATTACHED_PHARMACY') {
        const attached = await prisma.pharmacy.findFirst({ where: { clinicId: scope.clinicId, type: 'ATTACHED', isActive: true } });
        if (!attached) {
          results.push({ target, ok: false, reason: 'No attached medical shop is configured' });
          continue;
        }
        pharmacyId = attached.id;
      }

      if (!pharmacyId) {
        results.push({ target, ok: false, reason: 'A pharmacy must be selected' });
        continue;
      }

      const pharmacy = await prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
      if (!pharmacy || !pharmacy.isActive) {
        results.push({ target, ok: false, reason: 'Pharmacy not found or inactive' });
        continue;
      }

      // External pharmacies require recorded patient consent.
      let consentId: string | undefined;
      if (target === 'EXTERNAL_PHARMACY') {
        let consent = await prisma.consent.findFirst({
          where: { patientId: rx.patientId, pharmacyId, type: 'EXTERNAL_PHARMACY_SHARE', status: 'GRANTED' },
        });
        if (!consent) {
          if (!body.patientConsent) {
            results.push({ target, ok: false, reason: 'Patient consent is required to share with an external pharmacy' });
            continue;
          }
          consent = await prisma.consent.create({
            data: { patientId: rx.patientId, pharmacyId, type: 'EXTERNAL_PHARMACY_SHARE', scope: 'Prescription sharing', grantedByUserId: req.auth!.userId, status: 'GRANTED' },
          });
          await recordAudit({
            action: AUDIT_ACTION.CONSENT_GRANTED, entityType: 'Consent', entityId: consent.id,
            clinicId: scope.clinicId, userId: req.auth!.userId, metadata: { pharmacyId }, req,
          });
        }
        consentId = consent.id;
      }

      await prisma.prescriptionShare.create({
        data: {
          prescriptionId: id, versionId: version?.id, targetType: target, pharmacyId,
          channel: body.channel, consentId, sharedByUserId: req.auth!.userId,
        },
      });
      // Pharmacy receives the prescription in RECEIVED state and must review it.
      await prisma.pharmacyPrescription.upsert({
        where: { pharmacyId_prescriptionId: { pharmacyId, prescriptionId: id } },
        create: { pharmacyId, prescriptionId: id, status: PHARMACY_PRESCRIPTION_STATUS.RECEIVED },
        update: {},
      });

      const pharmacists = await prisma.pharmacyUser.findMany({ where: { pharmacyId, isActive: true }, select: { userId: true } });
      for (const p of pharmacists) {
        await notificationService.notify({
          userId: p.userId,
          clinicId: scope.clinicId,
          type: NOTIFICATION_TYPE.PHARMACY_PRESCRIPTION_RECEIVED,
          title: 'New prescription',
          body: `Patient: ${rx.patient.name} • Doctor: Dr. ${rx.doctor.name} • ${rx.prescriptionNo}`,
          entityType: 'Prescription',
          entityId: id,
          data: { prescriptionId: id, pharmacyId },
        });
      }

      await recordAudit({
        action: AUDIT_ACTION.PRESCRIPTION_SHARED, entityType: 'Prescription', entityId: id,
        clinicId: scope.clinicId, userId: req.auth!.userId, metadata: { target, pharmacyId, channel: body.channel }, req,
      });
      results.push({ target, ok: true });
    }

    if (results.some((r) => r.ok)) {
      await prisma.prescription.update({ where: { id }, data: { status: PRESCRIPTION_STATUS.SHARED } });
    }

    return reply.send({ results, prescription: await loadPrescription(id) });
  });

  // ------------------------------------------------------------------- PDF
  app.get('/:id/pdf', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const scope = await assertPrescriptionAccess(req.auth, id);
    const q = parseQuery(req, z.object({ version: z.coerce.number().optional() }));
    const rx = await loadPrescription(id);
    const version = q.version ? rx.versions.find((v) => v.version === q.version) : currentVersion(rx.versions);
    if (!version) throw AppError.notFound('Prescription version not found');

    const relPath = version.pdfPath ?? `prescriptions/${id}/v${version.version}.pdf`;
    const investigations = version.notesList.filter((n) => n.type === 'INVESTIGATION').map((n) => n.text);

    const bytes = await generateAndStorePdf({
      clinic: { name: rx.clinic.name, address: rx.clinic.address, phone: rx.clinic.phone, email: rx.clinic.email, logoUrl: rx.clinic.logoUrl },
      doctor: {
        name: rx.doctor.name, specialization: rx.doctor.specialization, qualification: rx.doctor.qualification,
        registrationNo: rx.doctor.registrationNo, prescriptionHeader: rx.doctor.prescriptionHeader,
        prescriptionFooter: rx.doctor.prescriptionFooter, signatureUrl: rx.doctor.digitalSignatureUrl,
      },
      patient: {
        name: rx.patient.name, patientCode: rx.patient.patientCode,
        age: ageFromDob(rx.patient.dateOfBirth), gender: rx.patient.gender, mobile: rx.patient.mobile,
      },
      prescriptionNo: rx.prescriptionNo,
      version: version.version,
      issuedAt: version.issuedAt,
      diagnosis: version.diagnosis,
      notes: version.notes,
      advice: version.advice,
      followUpDate: version.followUpDate,
      medicines: version.medicines,
      investigations,
      inkImagePath: version.inkImagePath,
    }, relPath);

    if (!version.pdfPath) {
      await prisma.prescriptionVersion.update({ where: { id: version.id }, data: { pdfPath: bytes } });
    }

    const file = await readFileBuffer(bytes);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${rx.prescriptionNo}-v${version.version}.pdf"`)
      .send(file);
  });

  // -------------------------------------------------------------- WhatsApp
  app.post('/:id/whatsapp', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PRESCRIPTION_SHARE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    // assertPrescriptionAccess already confirms the caller may read this
    // prescription (clinic staff, the patient, or a pharmacy it was shared with).
    const scope = await assertPrescriptionAccess(req.auth, id);
    const rx = await loadPrescription(id);
    if (!rx.doctor.whatsappSharingEnabled) throw AppError.forbidden('WhatsApp sharing is disabled for this doctor');

    const secureLink = `${config.PUBLIC_BASE_URL}/verify/${rx.prescriptionNo}`;
    // Prefer a secure link. Only minimal identifying detail is put in the message
    // so clinical information is not exposed in plain chat text.
    const message = `Your prescription from ${rx.clinic.name} is ready. Prescription No: ${rx.prescriptionNo}. View securely: ${secureLink}`;

    let providerSent = false;
    if (config.WHATSAPP_API_URL) {
      const res = await fetch(config.WHATSAPP_API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.WHATSAPP_API_TOKEN ? { authorization: `Bearer ${config.WHATSAPP_API_TOKEN}` } : {}),
        },
        body: JSON.stringify({ to: rx.patient.mobile, type: 'prescription_ready', prescriptionNo: rx.prescriptionNo, link: secureLink }),
      }).catch(() => null);
      providerSent = Boolean(res?.ok);
    }

    await prisma.prescriptionShare.create({
      data: {
        prescriptionId: id, targetType: 'PATIENT', patientId: rx.patientId,
        channel: 'WHATSAPP', sharedByUserId: req.auth!.userId,
      },
    });
    await recordAudit({
      action: AUDIT_ACTION.PRESCRIPTION_SHARED, entityType: 'Prescription', entityId: id,
      clinicId: scope.clinicId, userId: req.auth!.userId, metadata: { channel: 'WHATSAPP', providerSent }, req,
    });

    return reply.send({
      providerConfigured: Boolean(config.WHATSAPP_API_URL),
      providerSent,
      // The client uses this to open the device share sheet when no business API is configured.
      fallbackUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
      message,
      secureLink,
    });
  });

  // ------------------------------------------------- public verification
  app.get('/verify/:prescriptionNo', async (req, reply) => {
    const { prescriptionNo } = parseParams(req, z.object({ prescriptionNo: z.string().min(3).max(40) }));
    const rx = await prisma.prescription.findUnique({
      where: { prescriptionNo },
      select: {
        prescriptionNo: true, status: true, issuedAt: true,
        doctor: { select: { name: true, registrationNo: true } },
        clinic: { select: { name: true } },
        versions: { orderBy: { version: 'desc' }, take: 1, select: { version: true, status: true, issuedAt: true, contentHash: true, supersededByVersion: true } },
      },
    });
    if (!rx) throw AppError.notFound('No prescription found for this number');
    // Only non-sensitive verification metadata is returned.
    const v = rx.versions[0];
    const valid = v?.status === 'ISSUED' || v?.status === 'SUPERSEDED';
    return reply.send({
      valid,
      prescriptionNo: rx.prescriptionNo,
      clinicName: rx.clinic.name,
      doctorName: rx.doctor.name,
      registrationNo: rx.doctor.registrationNo,
      issuedAt: rx.issuedAt,
      version: v?.version,
      versionStatus: v?.status,
      // A superseded version indicates a corrected prescription has since been issued.
      corrected: v?.status === 'SUPERSEDED',
      contentHash: v?.contentHash,
    });
  });
}
