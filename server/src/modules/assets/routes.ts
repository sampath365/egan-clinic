import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseQuery } from '../../shared/validate.js';
import { readFileBuffer } from '../prescriptions/service.js';

/**
 * Serves branding assets that must be publicly readable: clinic logos and
 * doctor signatures/stamps. These are non-sensitive images printed on
 * prescriptions, so no authentication is required. Patient documents are NOT
 * served here — they go through the audited /api/documents/:id/download route.
 */
export async function assetRoutes(app: FastifyInstance) {
  app.get('/doctor-asset', async (req, reply) => {
    const q = parseQuery(req, z.object({
      doctorId: z.string().min(1).max(64),
      kind: z.enum(['signature', 'stamp']),
    }));

    const doctor = await prisma.doctor.findUnique({
      where: { id: q.doctorId },
      select: { digitalSignatureUrl: true, digitalStampUrl: true },
    });
    if (!doctor) throw AppError.notFound('Doctor not found');

    const path = q.kind === 'stamp' ? doctor.digitalStampUrl : doctor.digitalSignatureUrl;
    if (!path) throw AppError.notFound('No image has been uploaded');

    const buffer = await readFileBuffer(path);
    const ext = path.split('.').pop()?.toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return reply.header('content-type', type).header('cache-control', 'public, max-age=300').send(buffer);
  });

  app.get('/clinic-logo', async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().min(1).max(64) }));
    const clinic = await prisma.clinic.findUnique({ where: { id: q.clinicId }, select: { logoUrl: true } });
    if (!clinic?.logoUrl) throw AppError.notFound('No logo has been uploaded');
    const buffer = await readFileBuffer(clinic.logoUrl);
    const ext = clinic.logoUrl.split('.').pop()?.toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return reply.header('content-type', type).header('cache-control', 'public, max-age=300').send(buffer);
  });
}
