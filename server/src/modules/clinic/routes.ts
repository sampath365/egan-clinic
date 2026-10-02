import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION, CLINIC_SETTING_KEYS } from '../../shared/constants.js';
import { PERMISSIONS, ROLES } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess } from '../../shared/access.js';
import { getClinicSettings, setClinicSetting } from './service.js';

const timingsSchema = z.array(
  z.object({
    day: z.string().min(2).max(10),
    open: z.string().max(10).optional(),
    close: z.string().max(10).optional(),
    closed: z.boolean().optional(),
  }),
).max(7);

const createClinicSchema = z.object({
  name: z.string().min(2).max(160),
  logoUrl: z.string().max(500).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  registrationNo: z.string().max(80).optional(),
  licenseNo: z.string().max(80).optional(),
  timings: timingsSchema.optional(),
  emergencyContact: z.string().max(30).optional(),
  website: z.string().max(200).optional(),
  whatsappNumber: z.string().max(30).optional(),
  consultationFee: z.number().min(0).max(1_000_000).optional(),
  currency: z.string().max(8).optional(),
  timezone: z.string().max(60).optional(),
  ownerUserId: z.string().max(64).optional(),
});

const updateClinicSchema = createClinicSchema.partial();

const settingsSchema = z.object({
  medicalShopEnabled: z.boolean().optional(),
  customVitals: z.array(z.object({ key: z.string().min(1).max(40), label: z.string().min(1).max(60), unit: z.string().max(20).optional() })).max(20).optional(),
  defaultFollowUpDays: z.number().int().min(0).max(365).optional(),
  prescriptionFooter: z.string().max(1000).optional(),
  dataRetentionDays: z.number().int().min(0).max(36500).optional(),
  values: z.record(z.string().max(2000)).optional(),
});

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

export async function clinicRoutes(app: FastifyInstance) {
  // Create a clinic. The creating user becomes CLINIC_OWNER and clinic staff.
  app.post('/', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parseBody(req, createClinicSchema);
    const ownerUserId = body.ownerUserId ?? req.auth!.userId;
    // Only a super admin may create a clinic on behalf of another user.
    if (body.ownerUserId && body.ownerUserId !== req.auth!.userId && !req.auth!.roles.includes('SUPER_ADMIN')) {
      throw AppError.forbidden('Only a super admin can create a clinic for another user');
    }

    let slug = slugify(body.name);
    const clash = await prisma.clinic.findUnique({ where: { slug } });
    if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;

    const clinic = await prisma.clinic.create({
      data: {
        name: body.name,
        slug,
        logoUrl: body.logoUrl,
        address: body.address,
        phone: body.phone,
        email: body.email,
        registrationNo: body.registrationNo,
        licenseNo: body.licenseNo,
        timings: body.timings ? JSON.stringify(body.timings) : null,
        emergencyContact: body.emergencyContact,
        website: body.website,
        whatsappNumber: body.whatsappNumber,
        consultationFee: body.consultationFee ?? 0,
        currency: body.currency ?? 'INR',
        timezone: body.timezone ?? 'Asia/Kolkata',
        createdByUserId: req.auth!.userId,
        staff: { create: { userId: ownerUserId, designation: 'Owner' } },
      },
    });

    const ownerRole = await prisma.role.upsert({
      where: { name: ROLES.CLINIC_OWNER },
      create: { name: ROLES.CLINIC_OWNER, description: 'Clinic owner', isSystem: true },
      update: {},
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: ownerUserId, roleId: ownerRole.id } },
      create: { userId: ownerUserId, roleId: ownerRole.id },
      update: {},
    });

    await recordAudit({
      action: 'CLINIC_CREATED', entityType: 'Clinic', entityId: clinic.id,
      clinicId: clinic.id, userId: req.auth!.userId, actorName: null, req,
    });

    return reply.code(201).send({ clinic });
  });

  // Clinics visible to the caller.
  app.get('/', { preHandler: app.authenticate }, async (req, reply) => {
    const isSuper = req.auth!.roles.includes('SUPER_ADMIN');
    const clinics = await prisma.clinic.findMany({
      where: isSuper ? {} : { id: { in: req.auth!.clinicIds } },
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({ clinics });
  });

  app.get('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const clinic = await prisma.clinic.findUnique({ where: { id } });
    if (!clinic) throw AppError.notFound('Clinic not found');
    const settings = await getClinicSettings(id);
    return reply.send({ clinic, settings });
  });

  app.patch('/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const body = parseBody(req, updateClinicSchema);
    const data: Record<string, unknown> = { ...body };
    if (body.timings) data.timings = JSON.stringify(body.timings);
    delete data.ownerUserId;
    const clinic = await prisma.clinic.update({ where: { id }, data });
    return reply.send({ clinic });
  });

  app.get('/:id/settings', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    return reply.send({ settings: await getClinicSettings(id) });
  });

  app.put('/:id/settings', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_SETTINGS_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const body = parseBody(req, settingsSchema);

    if (body.medicalShopEnabled !== undefined) {
      await prisma.clinic.update({ where: { id }, data: { medicalShopEnabled: body.medicalShopEnabled } });
      await setClinicSetting(id, CLINIC_SETTING_KEYS.MEDICAL_SHOP_ENABLED, String(body.medicalShopEnabled));
      await recordAudit({
        action: AUDIT_ACTION.MEDICAL_SHOP_TOGGLED, entityType: 'Clinic', entityId: id,
        clinicId: id, userId: req.auth!.userId, metadata: { enabled: body.medicalShopEnabled }, req,
      });
    }
    if (body.customVitals) await setClinicSetting(id, CLINIC_SETTING_KEYS.CUSTOM_VITALS, JSON.stringify(body.customVitals));
    if (body.defaultFollowUpDays !== undefined) await setClinicSetting(id, CLINIC_SETTING_KEYS.DEFAULT_FOLLOW_UP_DAYS, String(body.defaultFollowUpDays));
    if (body.prescriptionFooter !== undefined) await setClinicSetting(id, CLINIC_SETTING_KEYS.PRESCRIPTION_FOOTER, body.prescriptionFooter);
    if (body.dataRetentionDays !== undefined) await setClinicSetting(id, CLINIC_SETTING_KEYS.DATA_RETENTION_DAYS, String(body.dataRetentionDays));
    if (body.values) {
      for (const [key, value] of Object.entries(body.values)) {
        if (key === CLINIC_SETTING_KEYS.MEDICAL_SHOP_ENABLED) continue; // handled above
        await setClinicSetting(id, key, value);
      }
    }

    return reply.send({ settings: await getClinicSettings(id) });
  });

  // --- Clinic services (billable items) ---
  app.get('/:id/services', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const services = await prisma.clinicService.findMany({ where: { clinicId: id, isActive: true }, orderBy: { name: 'asc' } });
    return reply.send({ services });
  });

  app.post('/:id/services', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.CLINIC_SETTINGS_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const body = parseBody(req, z.object({
      name: z.string().min(1).max(120),
      code: z.string().max(40).optional(),
      category: z.enum(['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'TEST', 'OTHER']).default('OTHER'),
      fee: z.number().min(0).max(1_000_000),
    }));
    const service = await prisma.clinicService.create({ data: { clinicId: id, ...body } });
    return reply.code(201).send({ service });
  });

  // --- Staff management ---
  app.get('/:id/staff', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.STAFF_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const staff = await prisma.clinicStaff.findMany({
      where: { clinicId: id },
      include: { user: { include: { roles: { include: { role: true } } } } },
      orderBy: { joinedAt: 'asc' },
    });
    return reply.send({
      staff: staff.map((s) => ({
        id: s.id,
        userId: s.userId,
        fullName: s.user.fullName,
        email: s.user.email,
        phone: s.user.phone,
        designation: s.designation,
        isActive: s.isActive,
        roles: s.user.roles.map((r) => r.role.name),
      })),
    });
  });

  // Add a user to the clinic and assign roles.
  app.post('/:id/staff', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.STAFF_MANAGE)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    assertClinicAccess(req.auth, id);
    const body = parseBody(req, z.object({
      userId: z.string().min(1).max(64),
      designation: z.string().max(80).optional(),
      roles: z.array(z.enum(['CLINIC_OWNER', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'CLINIC_STAFF', 'PHARMACIST'])).min(1),
    }));

    const user = await prisma.user.findUnique({ where: { id: body.userId } });
    if (!user) throw AppError.notFound('User not found');

    await prisma.clinicStaff.upsert({
      where: { clinicId_userId: { clinicId: id, userId: body.userId } },
      create: { clinicId: id, userId: body.userId, designation: body.designation },
      update: { designation: body.designation, isActive: true },
    });

    for (const roleName of body.roles) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        create: { name: roleName, isSystem: true },
        update: {},
      });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: body.userId, roleId: role.id } },
        create: { userId: body.userId, roleId: role.id },
        update: {},
      });
    }

    await recordAudit({
      action: AUDIT_ACTION.USER_PERMISSION_CHANGED, entityType: 'User', entityId: body.userId,
      clinicId: id, userId: req.auth!.userId, metadata: { roles: body.roles }, req,
    });

    return reply.code(201).send({ success: true });
  });

  app.delete('/:id/staff/:userId', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.STAFF_MANAGE)] }, async (req, reply) => {
    const { id, userId } = parseParams(req, z.object({ id: z.string().min(1), userId: z.string().min(1) }));
    assertClinicAccess(req.auth, id);
    await prisma.clinicStaff.updateMany({
      where: { clinicId: id, userId },
      data: { isActive: false },
    });
    await recordAudit({
      action: AUDIT_ACTION.USER_PERMISSION_CHANGED, entityType: 'User', entityId: userId,
      clinicId: id, userId: req.auth!.userId, metadata: { action: 'deactivated' }, req,
    });
    return reply.send({ success: true });
  });
}
