import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody, parseParams, parseQuery, idParamSchema } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION, INVOICE_STATUS, NOTIFICATION_TYPE, PAYMENT_METHODS } from '../../shared/constants.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../plugins/auth.js';
import { assertClinicAccess, assertPatientAccess, getClinicIdForRequest } from '../../shared/access.js';
import { notificationService } from '../../shared/notifications.js';
import { nextInvoiceNo } from '../patients/service.js';

const itemSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.enum(['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'TEST', 'OTHER']).default('OTHER'),
  fee: z.number().min(0).max(1_000_000),
  qty: z.number().min(1).max(1000).default(1),
});

function computeTotals(items: Array<{ fee: number; qty: number }>, discount: number, tax: number) {
  const subtotal = items.reduce((sum, i) => sum + i.fee * i.qty, 0);
  const total = Math.max(0, Math.round((subtotal - discount + tax) * 100) / 100);
  return { subtotal: Math.round(subtotal * 100) / 100, total };
}

function refreshStatus(amountPaid: number, total: number, refunded: number): string {
  if (refunded > 0 && amountPaid <= 0) return INVOICE_STATUS.REFUNDED;
  if (amountPaid <= 0) return INVOICE_STATUS.UNPAID;
  if (amountPaid + 0.001 < total) return INVOICE_STATUS.PARTIALLY_PAID;
  return INVOICE_STATUS.PAID;
}

export async function billingRoutes(app: FastifyInstance) {
  // ------------------------------------------------------------------ invoices
  app.get('/invoices', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.BILLING_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(), patientId: z.string().optional(),
      status: z.string().optional(), page: z.coerce.number().optional(), pageSize: z.coerce.number().optional(),
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
    if (q.status) where.status = q.status;

    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { patient: { select: { id: true, name: true, patientCode: true } }, payments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ]);
    return reply.send({ items, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
  });

  app.post('/invoices', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.BILLING_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      clinicId: z.string().max(64).optional(),
      patientId: z.string().min(1).max(64),
      consultationId: z.string().max(64).optional(),
      items: z.array(itemSchema).min(1).max(50),
      discount: z.number().min(0).max(1_000_000).default(0),
      tax: z.number().min(0).max(1_000_000).default(0),
    }));
    const clinicId = body.clinicId ?? (await getClinicIdForRequest(req));
    assertClinicAccess(req.auth, clinicId);
    await assertPatientAccess(req.auth, body.patientId);

    const { subtotal, total } = computeTotals(body.items, body.discount, body.tax);
    const invoiceNo = await nextInvoiceNo(clinicId);
    const invoice = await prisma.invoice.create({
      data: {
        clinicId, patientId: body.patientId, consultationId: body.consultationId,
        invoiceNo, itemsJson: JSON.stringify(body.items),
        subtotal, discount: body.discount, tax: body.tax, total,
        amountPaid: 0, balance: total, status: INVOICE_STATUS.UNPAID,
        createdByUserId: req.auth!.userId,
      },
    });
    return reply.code(201).send({ invoice });
  });

  app.get('/invoices/:id', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.BILLING_VIEW)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, name: true, patientCode: true, mobile: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        clinic: { select: { id: true, name: true, address: true, phone: true, currency: true } },
      },
    });
    if (!invoice) throw AppError.notFound('Invoice not found');
    await assertPatientAccess(req.auth, invoice.patientId);
    return reply.send({ invoice });
  });

  // ------------------------------------------------------------------ payments
  app.post('/payments', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PAYMENT_MANAGE)] }, async (req, reply) => {
    const body = parseBody(req, z.object({
      invoiceId: z.string().min(1).max(64),
      amount: z.number().positive().max(1_000_000),
      method: z.enum(PAYMENT_METHODS).default('CASH'),
      reference: z.string().max(120).optional(),
      notes: z.string().max(500).optional(),
    }));

    const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId }, include: { patient: { select: { name: true } } } });
    if (!invoice) throw AppError.notFound('Invoice not found');
    assertClinicAccess(req.auth, invoice.clinicId);
    if (invoice.status === INVOICE_STATUS.CANCELLED) throw AppError.conflict('Cannot pay a cancelled invoice');
    if (body.amount > invoice.balance + 0.001) throw AppError.badRequest('Payment exceeds the outstanding balance');

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          clinicId: invoice.clinicId, invoiceId: invoice.id, patientId: invoice.patientId,
          amount: body.amount, method: body.method, reference: body.reference,
          notes: body.notes, receivedByUserId: req.auth!.userId, status: 'SUCCESS',
        },
      });
      const amountPaid = Math.round((invoice.amountPaid + body.amount) * 100) / 100;
      const balance = Math.max(0, Math.round((invoice.total - amountPaid) * 100) / 100);
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid, balance, status: refreshStatus(amountPaid, invoice.total, 0) },
      });
      return p;
    });

    await notificationService.notifyPatient(invoice.patientId, {
      clinicId: invoice.clinicId,
      type: NOTIFICATION_TYPE.PAYMENT_RECEIPT,
      title: 'Payment received',
      body: `We received ${body.amount.toFixed(2)} for invoice ${invoice.invoiceNo}.`,
      entityType: 'Payment',
      entityId: payment.id,
    });
    await recordAudit({
      action: AUDIT_ACTION.PAYMENT_CREATED, entityType: 'Payment', entityId: payment.id,
      clinicId: invoice.clinicId, userId: req.auth!.userId, metadata: { invoiceId: invoice.id, amount: body.amount, method: body.method }, req,
    });

    return reply.code(201).send({ payment, invoice: await prisma.invoice.findUnique({ where: { id: invoice.id } }) });
  });

  app.get('/payments', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PAYMENT_VIEW)] }, async (req, reply) => {
    const q = parseQuery(req, z.object({
      clinicId: z.string().optional(), patientId: z.string().optional(),
      from: z.string().optional(), to: z.string().optional(),
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
    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }
    const payments = await prisma.payment.findMany({
      where,
      include: { patient: { select: { id: true, name: true, patientCode: true } }, invoice: { select: { invoiceNo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return reply.send({ payments });
  });

  app.post('/payments/:id/refund', { preHandler: [app.authenticate, requirePermission(PERMISSIONS.PAYMENT_REFUND)] }, async (req, reply) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({ amount: z.number().positive().max(1_000_000), reason: z.string().max(500).optional() }));

    const payment = await prisma.payment.findUnique({ where: { id } });
    if (!payment) throw AppError.notFound('Payment not found');
    assertClinicAccess(req.auth, payment.clinicId);
    const refundable = payment.amount - payment.refundedAmount;
    if (body.amount > refundable + 0.001) throw AppError.badRequest('Refund exceeds the refundable amount');

    const invoice = await prisma.invoice.findUnique({ where: { id: payment.invoiceId } });
    if (!invoice) throw AppError.notFound('Invoice not found');

    const refundedAmount = Math.round((payment.refundedAmount + body.amount) * 100) / 100;
    const result = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.update({
        where: { id },
        data: { refundedAmount, status: refundedAmount >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      });
      const amountPaid = Math.max(0, Math.round((invoice.amountPaid - body.amount) * 100) / 100);
      const balance = Math.max(0, Math.round((invoice.total - amountPaid) * 100) / 100);
      const inv = await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaid, balance, status: refreshStatus(amountPaid, invoice.total, refundedAmount) },
      });
      return { payment: p, invoice: inv };
    });

    await recordAudit({
      action: AUDIT_ACTION.PAYMENT_REFUNDED, entityType: 'Payment', entityId: id,
      clinicId: payment.clinicId, userId: req.auth!.userId, metadata: { amount: body.amount, reason: body.reason }, req,
    });
    return reply.send(result);
  });
}
