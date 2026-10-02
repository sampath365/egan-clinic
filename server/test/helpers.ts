/**
 * Shared test helpers. Tests exercise the real Fastify app over HTTP against
 * the seeded SQLite database — no mocks, so authorization, validation, and
 * persistence are all genuinely executed.
 */
import { buildApp } from '../src/app.js';
import { prisma } from '../src/shared/prisma.js';
import type { FastifyInstance } from 'fastify';

export const PASSWORD = 'Password123!';

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
    await app.ready();
  }
  return app;
}

export async function closeApp(): Promise<void> {
  if (app) {
    await app.close();
    app = null;
  }
  await prisma.$disconnect();
}

export interface Session { token: string; userId: string; clinicId: string; doctorId?: string }

export async function login(email: string): Promise<Session> {
  const server = await getApp();
  const res = await server.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password: PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`Login failed for ${email}: ${res.body}`);
  const body = res.json() as { token: string; user: { id: string; scopes: { clinicIds: string[]; doctorIds: string[] } } };

  // Resolve the clinic the user belongs to (seed clinic for staff, the
  // patient's clinic for a patient login).
  let clinicId = body.user.scopes.clinicIds[0];
  if (!clinicId) {
    const patient = await prisma.patient.findUnique({ where: { userId: body.user.id }, select: { clinicId: true } });
    clinicId = patient?.clinicId ?? '';
  }
  return { token: body.token, userId: body.user.id, clinicId, doctorId: body.user.scopes.doctorIds[0] };
}

export function auth(session: Session) {
  return { authorization: `Bearer ${session.token}` };
}

export async function inject(method: string, url: string, session?: Session, payload?: unknown) {
  const server = await getApp();
  const res = await server.inject({
    method: method as never,
    url,
    headers: session ? auth(session) : {},
    payload: payload as never,
  });
  return { status: res.statusCode, body: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : {} };
}
