import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ unreadOnly: z.coerce.boolean().optional(), take: z.coerce.number().optional() }));
    const notifications = await prisma.notification.findMany({
      where: { userId: req.auth!.userId, ...(q.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, q.take ?? 50)),
    });
    const unreadCount = await prisma.notification.count({ where: { userId: req.auth!.userId, isRead: false } });
    return reply.send({ notifications, unreadCount });
  });

  app.post('/:id/read', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    await prisma.notification.updateMany({
      where: { id, userId: req.auth!.userId },
      data: { isRead: true, readAt: new Date() },
    });
    return reply.send({ success: true });
  });

  app.post('/read-all', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_VIEW)] }, async (req, reply) => {
    await prisma.notification.updateMany({
      where: { userId: req.auth!.userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return reply.send({ success: true });
  });

  app.get('/preferences', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_VIEW)] }, async (req, reply) => {
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId },
      update: {},
    });
    return reply.send({ preferences: { ...prefs, channels: JSON.parse(prefs.channelsJson) as string[] } });
  });

  app.put('/preferences', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_VIEW)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      appointmentUpdates: z.boolean().optional(),
      prescriptionUpdates: z.boolean().optional(),
      reminders: z.boolean().optional(),
      payments: z.boolean().optional(),
      announcements: z.boolean().optional(),
      channels: z.array(z.enum(['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP', 'SMS'])).max(5).optional(),
    }));
    const { channels, ...rest } = body;
    const prefs = await prisma.notificationPreference.upsert({
      where: { userId: req.auth!.userId },
      create: { userId: req.auth!.userId, ...rest, ...(channels ? { channelsJson: JSON.stringify(channels) } : {}) },
      update: { ...rest, ...(channels ? { channelsJson: JSON.stringify(channels) } : {}) },
    });
    return reply.send({ preferences: { ...prefs, channels: JSON.parse(prefs.channelsJson) as string[] } });
  });

  // Clinic announcement broadcast (owner/staff with manage permission).
  app.post('/announce', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.NOTIFICATION_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().min(1).max(64),
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(2000),
      audience: z.enum(['ALL_PATIENTS', 'STAFF']).default('ALL_PATIENTS'),
    }));

    const { notificationService } = await import('../../shared/notifications.js');
    if (body.audience === 'STAFF') {
      const staff = await prisma.clinicStaff.findMany({ where: { clinicId: body.clinicId, isActive: true }, select: { userId: true } });
      for (const s of staff) {
        await notificationService.notify({
          userId: s.userId, clinicId: body.clinicId, type: 'CLINIC_ANNOUNCEMENT',
          title: body.title, body: body.body,
        });
      }
      return reply.send({ sent: staff.length });
    }

    const patients = await prisma.patient.findMany({ where: { clinicId: body.clinicId, userId: { not: null } }, select: { userId: true } });
    let sent = 0;
    for (const p of patients) {
      if (!p.userId) continue;
      await notificationService.notify({
        userId: p.userId, clinicId: body.clinicId, type: 'CLINIC_ANNOUNCEMENT',
        title: body.title, body: body.body,
      });
      sent += 1;
    }
    return reply.send({ sent });
  });
}
