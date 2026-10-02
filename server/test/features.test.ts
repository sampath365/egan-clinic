import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, getApp, inject, login, type Session } from './helpers.js';
import { prisma } from '../src/shared/prisma.js';

// Smallest valid 1x1 PNG, used to exercise the image upload endpoints.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngBuffer(): Buffer {
  return Buffer.from(PNG_BASE64, 'base64');
}

/** Builds a multipart/form-data body for Fastify's inject(). */
function multipart(fields: Record<string, string>, file: { field: string; filename: string; contentType: string; data: Buffer }) {
  const boundary = '----vitestboundary' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
  ));
  parts.push(file.data);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

describe('EGAN Clinic — new feature endpoints', () => {
  let owner: Session;
  let patient: Session;
  let doctorId: string;
  let patientId: string;

  beforeAll(async () => {
    owner = await login('owner@eganclinic.demo');
    patient = await login('patient@eganclinic.demo');
    const doctors = await inject('GET', `/api/doctors?clinicId=${owner.clinicId}`, owner);
    doctorId = (doctors.body.doctors as Array<{ id: string }>)[0]!.id;
    const patients = await inject('GET', `/api/patients?clinicId=${owner.clinicId}&pageSize=1`, owner);
    patientId = (patients.body.items as Array<{ id: string }>)[0]!.id;
  });

  afterAll(async () => { await closeApp(); });

  it('uploads a doctor signature and serves it publicly', async () => {
    const app = await getApp();
    const body = multipart({ kind: 'signature' }, { field: 'file', filename: 'sig.png', contentType: 'image/png', data: pngBuffer() });
    const res = await app.inject({
      method: 'POST',
      url: `/api/doctors/${doctorId}/signature`,
      headers: { ...body.headers, authorization: `Bearer ${owner.token}` },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { path: string }).path).toContain('doctors/');

    // Public asset route returns the image without authentication.
    const asset = await app.inject({ method: 'GET', url: `/api/assets/doctor-asset?doctorId=${doctorId}&kind=signature` });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['content-type']).toContain('image/png');
  });

  it('rejects a non-image signature upload', async () => {
    const app = await getApp();
    const body = multipart({ kind: 'signature' }, { field: 'file', filename: 'notes.txt', contentType: 'text/plain', data: Buffer.from('hello') });
    const res = await app.inject({
      method: 'POST',
      url: `/api/doctors/${doctorId}/signature`,
      headers: { ...body.headers, authorization: `Bearer ${owner.token}` },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(400);
  });

  it('uploads a clinic logo and serves it publicly', async () => {
    const app = await getApp();
    const body = multipart({}, { field: 'file', filename: 'logo.png', contentType: 'image/png', data: pngBuffer() });
    const res = await app.inject({
      method: 'POST',
      url: `/api/clinics/${owner.clinicId}/logo`,
      headers: { ...body.headers, authorization: `Bearer ${owner.token}` },
      payload: body.payload,
    });
    expect(res.statusCode).toBe(201);

    const asset = await app.inject({ method: 'GET', url: `/api/assets/clinic-logo?clinicId=${owner.clinicId}` });
    expect(asset.statusCode).toBe(200);
  });

  it('assigns a pharmacist to the attached pharmacy by email', async () => {
    const pharmacies = await inject('GET', `/api/pharmacies?clinicId=${owner.clinicId}`, owner);
    const attached = (pharmacies.body.pharmacies as Array<{ id: string; type: string }>).find((p) => p.type === 'ATTACHED');
    expect(attached).toBeTruthy();

    const ok = await inject('POST', `/api/pharmacies/${attached!.id}/users/by-email`, owner, { email: 'pharmacist@eganclinic.demo', role: 'PHARMACIST' });
    expect(ok.status).toBe(201);

    const missing = await inject('POST', `/api/pharmacies/${attached!.id}/users/by-email`, owner, { email: 'nobody@nowhere.test' });
    expect(missing.status).toBe(404);
  });

  it('lets a patient read their own token position', async () => {
    // Issue a token for the linked patient so a position exists.
    const me = await inject('GET', '/api/auth/me', patient);
    const patientIds = (me.body.user as { scopes: { patientIds: string[] } }).scopes.patientIds;
    if (patientIds.length === 0) return;

    await inject('POST', '/api/queue', owner, { clinicId: owner.clinicId, patientId: patientIds[0]!, doctorId });
    const queue = await inject('GET', '/api/queue', patient);
    const tokens = queue.body.tokens as Array<{ id: string }>;
    expect(tokens.length).toBeGreaterThan(0);

    const pos = await inject('GET', `/api/queue/${tokens[0]!.id}/position`, patient);
    expect(pos.status).toBe(200);
    expect(typeof (pos.body as { approximatePosition: number }).approximatePosition).toBe('number');
    expect((pos.body as { isEstimate: boolean }).isEstimate).toBe(true);
  });

  it('returns report data for consultations, outstanding payments and cancellations', async () => {
    const consultations = await inject('GET', `/api/reports/consultations?clinicId=${owner.clinicId}`, owner);
    expect(consultations.status).toBe(200);
    expect(consultations.body).toHaveProperty('total');

    const outstanding = await inject('GET', `/api/reports/outstanding-payments?clinicId=${owner.clinicId}`, owner);
    expect(outstanding.status).toBe(200);
    expect(outstanding.body).toHaveProperty('total');

    const cancelled = await inject('GET', `/api/reports/cancelled-appointments?clinicId=${owner.clinicId}`, owner);
    expect(cancelled.status).toBe(200);
    expect(Array.isArray(cancelled.body.items)).toBe(true);
  });

  it('attaches a patient document to a prescription and persists it', async () => {
    const created = await inject('POST', '/api/prescriptions', owner, { clinicId: owner.clinicId, patientId, doctorId });
    const rxId = (created.body.prescription as { id: string }).id;

    // Create a document record to attach (the file itself is not needed here).
    const doc = await prisma.medicalDocument.create({
      data: {
        clinicId: owner.clinicId, patientId, uploadedByUserId: owner.userId,
        title: 'vitest attachment', category: 'LAB_REPORT', fileName: 'x.pdf',
        mimeType: 'application/pdf', size: 10, storagePath: 'test/x.pdf',
      },
    });

    const put = await inject('PUT', `/api/prescriptions/${rxId}/content`, owner, {
      diagnosis: 'Test', medicines: [{ name: 'Paracetamol', dose: '1 tablet' }], attachmentDocumentIds: [doc.id],
    });
    expect(put.status).toBe(200);
    const version = (put.body.prescription as { versions: Array<{ attachments: Array<{ medicalDocument: { id: string } }> }> }).versions[0]!;
    expect(version.attachments.some((a) => a.medicalDocument.id === doc.id)).toBe(true);

    await prisma.medicalDocument.delete({ where: { id: doc.id } }).catch(() => undefined);
  });

  it('stores notification preferences per user', async () => {
    const updated = await inject('PUT', '/api/notifications/preferences', owner, {
      appointmentUpdates: true, prescriptionUpdates: false, reminders: true, payments: true, announcements: false,
      channels: ['IN_APP', 'EMAIL'],
    });
    expect(updated.status).toBe(200);
    expect((updated.body.preferences as { channels: string[] }).channels).toEqual(['IN_APP', 'EMAIL']);

    const fetched = await inject('GET', '/api/notifications/preferences', owner);
    expect((fetched.body.preferences as { prescriptionUpdates: boolean }).prescriptionUpdates).toBe(false);
  });

  it('onboards a new clinic and makes the creator the owner', async () => {
    const email = `vitest-owner-${Date.now()}@example.test`;
    const reg = await inject('POST', '/api/auth/register', undefined, { email, password: 'Password123!', fullName: 'Vitest Owner' });
    expect(reg.status).toBe(201);
    const token = (reg.body as { token: string }).token;

    const clinic = await inject('POST', '/api/clinics', { token, userId: '', clinicId: '' } as Session, {
      name: `Vitest Clinic ${Date.now()}`,
      email,
      consultationFee: 400,
      currency: 'INR',
    });
    expect(clinic.status).toBe(201);
    expect((clinic.body.clinic as { name: string }).name).toContain('Vitest Clinic');

    const me = await inject('GET', '/api/auth/me', { token, userId: '', clinicId: '' });
    expect((me.body.user as { roles: string[] }).roles).toContain('CLINIC_OWNER');
  });
});
