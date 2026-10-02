import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { parseQuery } from '../../shared/validate.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, getClinicIdForRequest } from '../../shared/access.js';
import { endOfDay, startOfDay } from '../../shared/utils.js';
import { INVOICE_STATUS } from '../../shared/constants.js';

/**
 * Reporting endpoints. All reports are clinic-scoped and derive from live data —
 * no cached or synthetic numbers.
 */
export async function reportRoutes(app: FastifyInstance) {
  const resolveRange = (from?: string, to?: string) => {
    const toDate = to ? endOfDay(new Date(to)) : endOfDay(new Date());
    const fromDate = from ? startOfDay(new Date(from)) : startOfDay(new Date(Date.now() - 29 * 86_400_000));
    return { fromDate, toDate };
  };

  app.get('/dashboard', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);

    const today = new Date();
    const dayStart = startOfDay(today);
    const dayEnd = endOfDay(today);

    const [
      todaysAppointments, waiting, completedToday, followUpsToday,
      revenueAgg, recentPatients, recentPrescriptions, pendingInvoices,
      pharmacyEnabled, newPharmacyRequests,
    ] = await Promise.all([
      prisma.appointment.count({ where: { clinicId, scheduledAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.queueToken.count({ where: { clinicId, queueDate: { startsWith: dayStart.toISOString().slice(0, 10) }, status: 'WAITING' } }),
      prisma.consultation.count({ where: { clinicId, status: 'COMPLETED', completedAt: { gte: dayStart, lte: dayEnd } } }),
      prisma.followUp.count({ where: { clinicId, dueDate: { gte: dayStart, lte: dayEnd }, status: 'PENDING' } }),
      prisma.payment.aggregate({ where: { clinicId, createdAt: { gte: dayStart, lte: dayEnd }, status: 'SUCCESS' }, _sum: { amount: true } }),
      prisma.patient.findMany({ where: { clinicId }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, name: true, patientCode: true, createdAt: true } }),
      prisma.prescription.findMany({
        where: { clinicId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, prescriptionNo: true, status: true, createdAt: true, patient: { select: { name: true } }, doctor: { select: { name: true } } },
      }),
      prisma.invoice.aggregate({ where: { clinicId, status: { in: [INVOICE_STATUS.UNPAID, INVOICE_STATUS.PARTIALLY_PAID] } }, _sum: { balance: true }, _count: true }),
      prisma.clinic.findUnique({ where: { id: clinicId }, select: { medicalShopEnabled: true } }),
      prisma.pharmacyPrescription.count({ where: { pharmacy: { clinicId }, status: { in: ['RECEIVED', 'UNDER_REVIEW'] } } }),
    ]);

    const isPharmacyOn = Boolean(pharmacyEnabled?.medicalShopEnabled);

    return reply.send({
      today: {
        appointments: todaysAppointments,
        waiting,
        completed: completedToday,
        followUps: followUpsToday,
        revenue: revenueAgg._sum.amount ?? 0,
      },
      recentPatients,
      recentPrescriptions,
      pendingPayments: { count: pendingInvoices._count, amount: pendingInvoices._sum.balance ?? 0 },
      // Pharmacy block is omitted entirely when the module is disabled.
      medicalShop: isPharmacyOn ? { newPrescriptionRequests: newPharmacyRequests } : null,
    });
  });

  app.get('/patients', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);

    const [total, newInRange, createdInRange] = await Promise.all([
      prisma.patient.count({ where: { clinicId } }),
      prisma.patient.count({ where: { clinicId, createdAt: { gte: fromDate, lte: toDate } } }),
      prisma.patient.findMany({
        where: { clinicId, createdAt: { gte: fromDate, lte: toDate } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Aggregate by calendar day in application code (portable across databases).
    const counts = new Map<string, number>();
    for (const p of createdInRange) {
      const day = p.createdAt.toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    const series = [...counts.entries()].map(([date, count]) => ({ date, count }));

    return reply.send({ totalPatients: total, newPatients: newInRange, series });
  });

  app.get('/appointments', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional(), doctorId: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);

    const where = { clinicId, scheduledAt: { gte: fromDate, lte: toDate }, ...(q.doctorId ? { doctorId: q.doctorId } : {}) };
    const grouped = await prisma.appointment.groupBy({ by: ['status'], where, _count: true });
    return reply.send({
      range: { from: fromDate, to: toDate },
      byStatus: grouped.map((g) => ({ status: g.status, count: g._count })),
      total: grouped.reduce((sum, g) => sum + g._count, 0),
    });
  });

  app.get('/revenue', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);

    const [byMethod, totals, outstanding] = await Promise.all([
      prisma.payment.groupBy({ by: ['method'], where: { clinicId, createdAt: { gte: fromDate, lte: toDate }, status: 'SUCCESS' }, _sum: { amount: true }, _count: true }),
      prisma.payment.aggregate({ where: { clinicId, createdAt: { gte: fromDate, lte: toDate }, status: 'SUCCESS' }, _sum: { amount: true, refundedAmount: true } }),
      prisma.invoice.aggregate({ where: { clinicId, status: { in: [INVOICE_STATUS.UNPAID, INVOICE_STATUS.PARTIALLY_PAID] } }, _sum: { balance: true }, _count: true }),
    ]);
    return reply.send({
      range: { from: fromDate, to: toDate },
      totalCollected: totals._sum.amount ?? 0,
      totalRefunded: totals._sum.refundedAmount ?? 0,
      netRevenue: (totals._sum.amount ?? 0) - (totals._sum.refundedAmount ?? 0),
      byMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0, count: m._count })),
      outstanding: { count: outstanding._count, amount: outstanding._sum.balance ?? 0 },
    });
  });

  app.get('/doctors', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);

    const doctors = await prisma.doctor.findMany({ where: { clinicId, isActive: true }, select: { id: true, name: true, specialization: true } });
    const rows = await Promise.all(doctors.map(async (d) => {
      const [appointments, consultations, prescriptions] = await Promise.all([
        prisma.appointment.count({ where: { doctorId: d.id, scheduledAt: { gte: fromDate, lte: toDate } } }),
        prisma.consultation.count({ where: { doctorId: d.id, startedAt: { gte: fromDate, lte: toDate } } }),
        prisma.prescription.count({ where: { doctorId: d.id, createdAt: { gte: fromDate, lte: toDate } } }),
      ]);
      return { ...d, appointments, consultations, prescriptions };
    }));
    return reply.send({ range: { from: fromDate, to: toDate }, doctors: rows });
  });

  app.get('/prescriptions', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);

    const where = { clinicId, createdAt: { gte: fromDate, lte: toDate } };
    const [byStatus, total, shared, pharmacyForwarded] = await Promise.all([
      prisma.prescription.groupBy({ by: ['status'], where, _count: true }),
      prisma.prescription.count({ where }),
      prisma.prescriptionShare.count({ where: { prescription: { clinicId }, createdAt: { gte: fromDate, lte: toDate } } }),
      prisma.pharmacyPrescription.count({ where: { pharmacy: { clinicId }, receivedAt: { gte: fromDate, lte: toDate } } }),
    ]);
    return reply.send({
      range: { from: fromDate, to: toDate },
      total,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      totalShares: shared,
      pharmacyForwarded,
    });
  });

  app.get('/follow-ups', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);
    const grouped = await prisma.followUp.groupBy({ by: ['status'], where: { clinicId, dueDate: { gte: fromDate, lte: toDate } }, _count: true });
    return reply.send({ range: { from: fromDate, to: toDate }, byStatus: grouped.map((g) => ({ status: g.status, count: g._count })) });
  });

  app.get('/pharmacy-prescriptions', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { medicalShopEnabled: true } });
    if (!clinic?.medicalShopEnabled) return reply.send({ enabled: false, items: [] });

    const { fromDate, toDate } = resolveRange(q.from, q.to);
    const rows = await prisma.pharmacyPrescription.findMany({
      where: { pharmacy: { clinicId }, receivedAt: { gte: fromDate, lte: toDate } },
      include: { pharmacy: { select: { name: true } }, prescription: { select: { prescriptionNo: true, patient: { select: { name: true } } } } },
      orderBy: { receivedAt: 'desc' },
    });
    return reply.send({ enabled: true, items: rows });
  });

  app.get('/cancelled-appointments', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.REPORT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({ clinicId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }));
    const clinicId = q.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    const { fromDate, toDate } = resolveRange(q.from, q.to);
    const items = await prisma.appointment.findMany({
      where: { clinicId, status: { in: ['CANCELLED', 'NO_SHOW'] }, scheduledAt: { gte: fromDate, lte: toDate } },
      include: { patient: { select: { name: true } }, doctor: { select: { name: true } } },
      orderBy: { scheduledAt: 'desc' },
    });
    return reply.send({ items });
  });
}
