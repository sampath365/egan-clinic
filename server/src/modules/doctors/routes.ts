import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { PERMISSIONS, ROLES } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertDoctorAccess, getClinicIdForRequest } from '../../shared/access.js';
import { writeFileBuffer } from '../prescriptions/service.js';

const timingsSchema = z.array(z.object({
  day: z.string().min(2).max(10),
  open: z.string().max(10).optional(),
  close: z.string().max(10).optional(),
  closed: z.boolean().optional(),
})).max(7);

const createDoctorSchema = z.object({
  clinicId: z.string().min(1).max(64).optional(),
  userId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(160),
  photoUrl: z.string().max(500).optional(),
  specialization: z.string().max(120).optional(),
  qualification: z.string().max(200).optional(),
  registrationNo: z.string().max(80).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  consultationFee: z.number().min(0).max(1_000_000).optional(),
  followUpFee: z.number().min(0).max(1_000_000).optional(),
  timings: timingsSchema.optional(),
  availableDays: z.string().max(60).optional(),
  digitalSignatureUrl: z.string().max(500).optional(),
  digitalStampUrl: z.string().max(500).optional(),
  prescriptionHeader: z.string().max(2000).optional(),
  prescriptionFooter: z.string().max(2000).optional(),
  defaultMedicineInstructions: z.string().max(500).optional(),
  defaultFollowUpDays: z.number().int().min(0).max(365).optional(),
  voiceInputEnabled: z.boolean().optional(),
  inkPrescriptionEnabled: z.boolean().optional(),
  whatsappSharingEnabled: z.boolean().optional(),
  patientNotificationEnabled: z.boolean().optional(),
});

const updateDoctorSchema = createDoctorSchema.partial().omit({ clinicId: true });

export async function doctorRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), activeOnly: z.coerce.boolean().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const doctors = await prisma.doctor.findMany({
      where: { clinicId, ...(q.activeOnly ? { isActive: true } : {}) },
      orderBy: { name: 'asc' },
    });
    return reply.send({ doctors });
  });

  app.get('/me', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_VIEW)] }, async (req, reply) => {
    const doctor = await prisma.doctor.findFirst({ where: { userId: req.auth!.userId } });
    if (!doctor) throw AppError.notFound('No doctor profile is linked to your account');
    return reply.send({ doctor });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertDoctorAccess(req.auth, id);
    const doctor = await prisma.doctor.findUnique({ where: { id }, include: { leaves: true } });
    if (!doctor) throw AppError.notFound('Doctor not found');
    return reply.send({ doctor });
  });

  app.post('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, createDoctorSchema);
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const data: Record<string, unknown> = { ...body, clinicId };
    if (body.timings) data.timings = JSON.stringify(body.timings);
    delete data.clinicId;
    const doctor = await prisma.doctor.create({ data: data as never });

    // If a user account is linked, ensure it carries the DOCTOR role.
    if (body.userId) {
      const role = await prisma.role.upsert({ where: { name: ROLES.DOCTOR }, create: { name: ROLES.DOCTOR, isSystem: true }, update: {} });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: body.userId, roleId: role.id } },
        create: { userId: body.userId, roleId: role.id },
        update: {},
      });
    }
    return reply.code(201).send({ doctor });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertDoctorAccess(req.auth, id);
    const body = parseBody(req, updateDoctorSchema);
    const data: Record<string, unknown> = { ...body };
    if (body.timings) data.timings = JSON.stringify(body.timings);
    const doctor = await prisma.doctor.update({ where: { id }, data: data as never });
    return reply.send({ doctor });
  });

  // --- Digital signature & stamp ---
  // Stored under the doctor's own folder and served through a public route so
  // the browser and the PDF generator can both fetch them.
  app.post('/:id/signature', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertDoctorAccess(req.auth, id);
    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw AppError.notFound('Doctor not found');

    const data = await req.file();
    if (!data) throw AppError.badRequest('No file was uploaded');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(data.mimetype)) {
      throw AppError.badRequest('Signature and stamp must be a PNG, JPEG or WebP image');
    }
    const buffer = await data.toBuffer();
    if (buffer.length > 5 * 1024 * 1024) throw AppError.badRequest('Image exceeds the 5 MB limit');

    const kind = data.fields?.kind && String((data.fields.kind as { value?: string }).value) === 'stamp' ? 'stamp' : 'signature';
    const ext = data.mimetype === 'image/png' ? 'png' : data.mimetype === 'image/webp' ? 'webp' : 'jpg';
    const relPath = `doctors/${id}/${kind}-${Date.now()}.${ext}`;
    await writeFileBuffer(relPath, buffer);

    const doctorUpdated = await prisma.doctor.update({
      where: { id },
      data: kind === 'stamp' ? { digitalStampUrl: relPath } : { digitalSignatureUrl: relPath },
    });
    return reply.code(201).send({ kind, path: relPath, doctor: doctorUpdated });
  });

  // --- Leave management ---
  app.post('/:id/leaves', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertDoctorAccess(req.auth, id);
    const body = parseBody(req, z.object({
      fromDate: z.coerce.date(),
      toDate: z.coerce.date(),
      reason: z.string().max(300).optional(),
    }));
    if (body.toDate < body.fromDate) throw AppError.badRequest('toDate must be on or after fromDate');
    const leave = await prisma.doctorLeave.create({ data: { doctorId: id, ...body } });
    return reply.code(201).send({ leave });
  });

  app.delete('/:id/leaves/:leaveId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_MANAGE)] }, async (req, reply) => {
    const { id, leaveId } = parseParams(req, z.object({ id: z.string().min(1), leaveId: z.string().min(1) }));
    await assertDoctorAccess(req.auth, id);
    await prisma.doctorLeave.deleteMany({ where: { id: leaveId, doctorId: id } });
    return reply.send({ success: true });
  });

  // --- Availability for a given date (used by appointment booking) ---
  app.get('/:id/availability', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.DOCTOR_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await assertDoctorAccess(req.auth, id);
    const q = parseQuery(req, z.object({ date: z.string().min(8).max(10) }));
    const date = new Date(`${q.date}T00:00:00`);
    if (Number.isNaN(date.getTime())) throw AppError.badRequest('Invalid date');

    const doctor = await prisma.doctor.findUnique({ where: { id } });
    if (!doctor) throw AppError.notFound('Doctor not found');

    const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayName = dayNames[date.getDay()]!;
    const availableDays = (doctor.availableDays ?? '').split(',').map((d) => d.trim().toUpperCase()).filter(Boolean);
    const onLeave = await prisma.doctorLeave.findFirst({
      where: { doctorId: id, fromDate: { lte: new Date(date.getTime() + 86_399_999) }, toDate: { gte: date } },
    });

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        scheduledAt: { gte: date, lte: new Date(date.getTime() + 86_399_999) },
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      },
      select: { scheduledAt: true, durationMin: true },
      orderBy: { scheduledAt: 'asc' },
    });

    return reply.send({
      date: q.date,
      dayName,
      isWorkingDay: availableDays.length === 0 ? true : availableDays.includes(dayName),
      onLeave: Boolean(onLeave),
      bookedSlots: appointments,
      timings: doctor.timings ? JSON.parse(doctor.timings) : [],
    });
  });
}
