import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../shared/prisma.js';
import { AppError } from '../../shared/errors.js';
import { parseBody } from '../../shared/validate.js';
import { recordAudit } from '../../shared/audit.js';
import { AUDIT_ACTION } from '../../shared/constants.js';
import { resolveAuthUser, type AuthUser } from '../../plugins/auth.js';
import { getClientIp } from '../../shared/utils.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().min(1).max(120),
  phone: z.string().max(30).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

function publicUser(auth: AuthUser, profile: { fullName: string; avatarUrl: string | null; phone: string | null }) {
  return {
    id: auth.userId,
    email: auth.email,
    fullName: profile.fullName,
    phone: profile.phone,
    avatarUrl: profile.avatarUrl,
    roles: auth.roles,
    permissions: auth.permissions,
    scopes: {
      clinicIds: auth.clinicIds,
      doctorIds: auth.doctorIds,
      pharmacyIds: auth.pharmacyIds,
      patientIds: auth.patientIds,
    },
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = parseBody(req, loginSchema);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Constant-ish response regardless of whether the account exists.
    if (!user || !user.isActive) {
      throw AppError.unauthorized('Invalid email or password');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await recordAudit({ action: 'LOGIN_FAILED', entityType: 'User', entityId: user.id, req });
      throw AppError.unauthorized('Invalid email or password');
    }

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const auth = await resolveAuthUser(user.id);
    if (!auth) throw AppError.unauthorized('Account is not active');

    const token = await reply.jwtSign({ sub: user.id, email: user.email, tv: user.tokenVersion });

    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenId: `${user.id}:${Date.now()}`,
        userAgent: String(req.headers['user-agent'] ?? ''),
        ipAddress: getClientIp(req),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
      },
    });

    await recordAudit({ action: AUDIT_ACTION.LOGIN, entityType: 'User', entityId: user.id, userId: user.id, actorName: user.fullName, req });

    return reply.send({
      token,
      user: publicUser(auth, { fullName: user.fullName, avatarUrl: user.avatarUrl, phone: user.phone }),
    });
  });

  app.post('/register', async (req, reply) => {
    const body = parseBody(req, registerSchema);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) throw AppError.conflict('An account with this email already exists');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        fullName: body.fullName,
        phone: body.phone,
      },
    });

    const auth = await resolveAuthUser(user.id);
    const token = await reply.jwtSign({ sub: user.id, email: user.email, tv: user.tokenVersion });
    return reply.code(201).send({
      token,
      user: publicUser(auth!, { fullName: user.fullName, avatarUrl: user.avatarUrl, phone: user.phone }),
    });
  });

  app.get('/me', { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw AppError.notFound('User not found');
    return reply.send({
      user: publicUser(req.auth!, { fullName: user.fullName, avatarUrl: user.avatarUrl, phone: user.phone }),
    });
  });

  app.post('/logout', { preHandler: app.authenticate }, async (req, reply) => {
    await recordAudit({ action: AUDIT_ACTION.LOGOUT, entityType: 'User', entityId: req.auth!.userId, userId: req.auth!.userId, req });
    return reply.send({ success: true });
  });

  app.post('/logout-all', { preHandler: app.authenticate }, async (req, reply) => {
    // Bumping tokenVersion invalidates every previously issued JWT.
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await prisma.authSession.updateMany({
      where: { userId: req.auth!.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit({ action: 'LOGOUT_ALL', entityType: 'User', entityId: req.auth!.userId, userId: req.auth!.userId, req });
    return reply.send({ success: true });
  });

  app.post('/change-password', { preHandler: app.authenticate }, async (req, reply) => {
    const body = parseBody(req, changePasswordSchema);
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw AppError.notFound('User not found');
    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) throw AppError.badRequest('Current password is incorrect');

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, tokenVersion: { increment: 1 } },
    });
    return reply.send({ success: true });
  });
}
