import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../shared/config.js';
import { AppError } from '../shared/errors.js';
import { prisma } from '../shared/prisma.js';
import { ROLE_PERMISSIONS, type PermissionCode, type RoleName } from '../shared/permissions.js';

export interface AuthUser {
  userId: string;
  email: string;
  roles: RoleName[];
  permissions: PermissionCode[];
  clinicIds: string[];
  doctorIds: string[];
  pharmacyIds: string[];
  patientIds: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthUser;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; tv: number };
    user: { sub: string; email: string; tv: number };
  }
}

/**
 * Resolves the caller's effective identity: roles plus every resource scope
 * (clinics, doctor profiles, pharmacies, patient profiles) they may act on.
 * Rebuilt per request from the database so role/permission changes and
 * token revocation take effect immediately.
 */
export async function resolveAuthUser(userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: { include: { role: true } },
      staff: true,
      doctor: true,
      pharmacyUsers: true,
      patient: true,
    },
  });
  if (!user || !user.isActive) return null;

  const roles = user.roles.map((r) => r.role.name as RoleName);
  const permissions = new Set<PermissionCode>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role] ?? []) permissions.add(perm);
  }

  return {
    userId: user.id,
    email: user.email,
    roles,
    permissions: [...permissions],
    clinicIds: user.staff.map((s) => s.clinicId),
    doctorIds: user.doctor ? [user.doctor.id] : [],
    pharmacyIds: user.pharmacyUsers.filter((p) => p.isActive).map((p) => p.pharmacyId),
    patientIds: user.patient ? [user.patient.id] : [],
  };
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: { expiresIn: config.JWT_EXPIRES_IN },
  });

  app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
    let payload: { sub: string; tv: number };
    try {
      payload = await req.jwtVerify();
    } catch {
      throw AppError.unauthorized('Invalid or expired session');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive) throw AppError.unauthorized('Account is not active');
    // tokenVersion invalidates all previously issued tokens (logout all devices).
    if (user.tokenVersion !== payload.tv) throw AppError.unauthorized('Session has been revoked');

    const auth = await resolveAuthUser(payload.sub);
    if (!auth) throw AppError.unauthorized('Account is not active');
    req.auth = auth;
  });
});

/** Throws unless the caller holds at least one of the given roles. */
export function requireRole(...roles: RoleName[]) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw AppError.unauthorized();
    if (!req.auth.roles.some((r) => roles.includes(r))) {
      throw AppError.forbidden('Your role does not allow this action');
    }
  };
}

/** Throws unless the caller holds every one of the given permissions. */
export function requirePermission(...permissions: PermissionCode[]) {
  return async (req: FastifyRequest) => {
    if (!req.auth) throw AppError.unauthorized();
    const missing = permissions.filter((p) => !req.auth!.permissions.includes(p));
    if (missing.length > 0) {
      throw AppError.forbidden('Your role does not allow this action');
    }
  };
}

export function hasPermission(auth: AuthUser | undefined, permission: PermissionCode): boolean {
  return Boolean(auth?.permissions.includes(permission));
}

export function isSuperAdmin(auth: AuthUser | undefined): boolean {
  return Boolean(auth?.roles.includes('SUPER_ADMIN'));
}
