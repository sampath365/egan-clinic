import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import fs from 'node:fs/promises';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION, DOCUMENT_CATEGORY } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { ensureStorageDir, readFileBuffer, storagePathFor } from '../prescriptions/service.js';

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/dicom',
]);

export async function documentRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCUMENT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      patientId: z.string().min(1).max(64),
      category: z.string().optional(),
    }));
    await assertPatientAccess(req.auth, q.patientId);
    const documents = await prisma.medicalDocument.findMany({
      where: { patientId: q.patientId, ...(q.category ? { category: q.category } : {}) },
      select: {
        id: true, title: true, category: true, fileName: true, mimeType: true,
        size: true, isConfidential: true, createdAt: true, uploadedByUserId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ documents });
  });

  // Multipart upload. Files are stored outside the web root and only ever served
  // through an authorized, audited download endpoint.
  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCUMENT_UPLOAD)] }, async (req, reply) => {
    const query = parseQuery(req, z.object({
      patientId: z.string().min(1).max(64),
      title: z.string().min(1).max(200),
      category: z.enum(DOCUMENT_CATEGORY).default('OTHER'),
      clinicId: z.string().max(64).optional(),
    }));
    await assertPatientAccess(req.auth, query.patientId, { write: true });
    const clinicId = query.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    const data = await req.file();
    if (!data) throw AppError.badRequest('No file was uploaded');
    if (!ALLOWED_MIME.has(data.mimetype)) throw AppError.badRequest('Unsupported file type');
    const buffer = await data.toBuffer();
    if (buffer.length > 25 * 1024 * 1024) throw AppError.badRequest('File exceeds the 25 MB limit');

    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
    const relPath = `documents/${query.patientId}/${Date.now()}-${safeName}`;
    await ensureStorageDir(`documents/${query.patientId}`);
    await fs.writeFile(storagePathFor(relPath), buffer);

    const document = await prisma.medicalDocument.create({
      data: {
        clinicId, patientId: query.patientId, uploadedByUserId: req.auth!.userId,
        title: query.title, category: query.category, fileName: safeName,
        mimeType: data.mimetype, size: buffer.length, storagePath: relPath,
      },
    });
    await recordAudit({
      action: AUDIT_ACTION.DOCUMENT_UPLOADED, entityType: 'MedicalDocument', entityId: document.id,
      clinicId, userId: req.auth!.userId, metadata: { patientId: query.patientId, category: query.category }, req,
    });
    return reply.code(201).send({ document });
  });

  // Authorized download. Never expose storagePath directly to clients.
  app.get('/:id/download', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCUMENT_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const document = await prisma.medicalDocument.findUnique({ where: { id } });
    if (!document) throw AppError.notFound('Document not found');
    await assertPatientAccess(req.auth, document.patientId);

    const buffer = await readFileBuffer(document.storagePath);
    await recordAudit({
      action: AUDIT_ACTION.DOCUMENT_VIEWED, entityType: 'MedicalDocument', entityId: id,
      clinicId: document.clinicId, userId: req.auth!.userId, req,
    });
    return reply
      .header('content-type', document.mimeType)
      .header('content-disposition', `inline; filename="${document.fileName}"`)
      .send(buffer);
  });

  app.delete('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCUMENT_DELETE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const document = await prisma.medicalDocument.findUnique({ where: { id } });
    if (!document) throw AppError.notFound('Document not found');
    assertClinicAccess(req.auth, document.clinicId);

    await prisma.medicalDocument.delete({ where: { id } });
    await fs.rm(storagePathFor(document.storagePath), { force: true }).catch(() => undefined);
    await recordAudit({
      action: 'DOCUMENT_DELETED', entityType: 'MedicalDocument', entityId: id,
      clinicId: document.clinicId, userId: req.auth!.userId, req,
    });
    return reply.send({ success: true });
  });
}
