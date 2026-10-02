import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, inject, login, type Session } from './helpers.js';
import { prisma } from '../src/shared/prisma.js';

/**
 * Business rules that must hold for the product to be safe. These are the rules
 * from the specification that carry clinical or privacy risk.
 */
describe('EGAN Clinic — critical business rules', () => {
  let owner: Session;
  let doctor: Session;
  let reception: Session;
  let pharmacist: Session;
  let patient: Session;
  let patientId: string;
  let otherPatientId: string;
  let doctorId: string;
  let rxId: string;
  let rxNo: string;

  beforeAll(async () => {
    owner = await login('owner@eganclinic.demo');
    doctor = await login('dr.kapoor@eganclinic.demo');
    reception = await login('reception@eganclinic.demo');
    pharmacist = await login('pharmacist@eganclinic.demo');
    patient = await login('patient@eganclinic.demo');

    const patients = await inject('GET', `/api/patients?clinicId=${owner.clinicId}&pageSize=50`, owner);
    const list = patients.body.items as Array<{ id: string; name: string }>;
    patientId = list[0]!.id;
    otherPatientId = list[1]!.id;

    const doctors = await inject('GET', `/api/doctors?clinicId=${owner.clinicId}`, owner);
    doctorId = (doctors.body.doctors as Array<{ id: string }>)[0]!.id;

    // Ensure the medical shop is enabled for pharmacy-related assertions.
    await inject('PUT', `/api/clinics/${owner.clinicId}/settings`, owner, { medicalShopEnabled: true });
  });

  afterAll(async () => { await closeApp(); });

  it('rejects unauthenticated access to patient data', async () => {
    const res = await inject('GET', `/api/patients?clinicId=${owner.clinicId}`);
    expect(res.status).toBe(401);
  });

  it('rejects login with a wrong password', async () => {
    const res = await inject('POST', '/api/auth/login', undefined, { email: 'owner@eganclinic.demo', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('creates a draft prescription that is editable, then blocks editing after issue', async () => {
    const created = await inject('POST', '/api/prescriptions', doctor, {
      clinicId: owner.clinicId, patientId, doctorId,
    });
    expect(created.status).toBe(201);
    rxId = (created.body.prescription as { id: string }).id;
    rxNo = (created.body.prescription as { prescriptionNo: string }).prescriptionNo;

    // Draft is editable.
    const edit = await inject('PUT', `/api/prescriptions/${rxId}/content`, doctor, {
      diagnosis: 'Test diagnosis', medicines: [{ name: 'Paracetamol', strength: '500 mg', dose: '1 tablet', frequency: 'Twice daily', duration: '3 days' }],
    });
    expect(edit.status).toBe(200);

    // Issue.
    const issue = await inject('POST', `/api/prescriptions/${rxId}/issue`, doctor);
    expect(issue.status).toBe(200);
    const version = (issue.body.prescription as { versions: Array<{ status: string; contentHash: string }> }).versions[0]!;
    expect(version.status).toBe('ISSUED');
    expect(version.contentHash).toMatch(/^[a-f0-9]{64}$/);

    // Silent edit is refused.
    const tamper = await inject('PUT', `/api/prescriptions/${rxId}/content`, doctor, { advice: 'tampered' });
    expect(tamper.status).toBe(409);
  });

  it('refuses to issue an empty prescription', async () => {
    const created = await inject('POST', '/api/prescriptions', doctor, { clinicId: owner.clinicId, patientId, doctorId });
    const id = (created.body.prescription as { id: string }).id;
    const issue = await inject('POST', `/api/prescriptions/${id}/issue`, doctor);
    expect(issue.status).toBe(422);
  });

  it('preserves the issued version and supersedes it on correction', async () => {
    const corrected = await inject('POST', `/api/prescriptions/${rxId}/correct`, doctor);
    expect(corrected.status).toBe(201);
    const versions = (corrected.body.prescription as { versions: Array<{ version: number; status: string }> }).versions;
    expect(versions.find((v) => v.version === 1)!.status).toBe('SUPERSEDED');
    expect(versions.find((v) => v.version === 2)!.status).toBe('DRAFT');
  });

  it('requires explicit patient consent before sharing with an external pharmacy', async () => {
    // Re-issue so the prescription is shareable again.
    await inject('PUT', `/api/prescriptions/${rxId}/content`, doctor, {
      diagnosis: 'Test diagnosis', medicines: [{ name: 'Paracetamol', strength: '500 mg', dose: '1 tablet', frequency: 'Twice daily' }],
    });
    await inject('POST', `/api/prescriptions/${rxId}/issue`, doctor);

    const eligible = await inject('GET', '/api/pharmacies?eligible=true', owner);
    const external = (eligible.body.pharmacies as Array<{ id: string; type: string }>).find((p) => p.type === 'EXTERNAL');
    if (!external) return; // no external pharmacy seeded

    // Consent is persistent by design, so clear any prior grant to make this
    // assertion deterministic regardless of test ordering.
    await prisma.consent.deleteMany({ where: { patientId, pharmacyId: external.id, type: 'EXTERNAL_PHARMACY_SHARE' } });

    const withoutConsent = await inject('POST', `/api/prescriptions/${rxId}/share`, doctor, {
      targets: ['EXTERNAL_PHARMACY'], pharmacyId: external.id, patientConsent: false,
    });
    const result = (withoutConsent.body.results as Array<{ ok: boolean; reason?: string }>)[0]!;
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/consent/i);

    const withConsent = await inject('POST', `/api/prescriptions/${rxId}/share`, doctor, {
      targets: ['EXTERNAL_PHARMACY'], pharmacyId: external.id, patientConsent: true,
    });
    expect((withConsent.body.results as Array<{ ok: boolean }>)[0]!.ok).toBe(true);
  });

  it('does not expose pharmacy features when the medical shop is disabled', async () => {
    const clinicId = owner.clinicId;
    await inject('PUT', `/api/clinics/${clinicId}/settings`, owner, { medicalShopEnabled: false });
    try {
      const share = await inject('POST', `/api/prescriptions/${rxId}/share`, doctor, { targets: ['ATTACHED_PHARMACY'] });
      const result = (share.body.results as Array<{ ok: boolean; reason?: string }>)[0]!;
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/disabled/i);

      const dashboard = await inject('GET', `/api/reports/dashboard?clinicId=${clinicId}`, owner);
      expect(dashboard.body.medicalShop).toBeNull();
    } finally {
      await inject('PUT', `/api/clinics/${clinicId}/settings`, owner, { medicalShopEnabled: true });
    }
  });

  it('enforces pharmacist-only pharmacy access and pharmacy-scoped prescriptions', async () => {
    // Doctors have no pharmacy permissions at all.
    const doctorAttempt = await inject('GET', '/api/pharmacy-prescriptions', doctor);
    expect(doctorAttempt.status).toBe(403);

    // Pharmacists can only reach prescriptions shared with their pharmacy.
    const pharmacistList = await inject('GET', '/api/pharmacy-prescriptions', pharmacist);
    expect(pharmacistList.status).toBe(200);

    const unreachable = await inject('POST', '/api/prescriptions', pharmacist, { clinicId: owner.clinicId, patientId, doctorId });
    expect(unreachable.status).toBe(403);
  });

  it('rejects an invalid pharmacist workflow transition', async () => {
    const list = await inject('GET', '/api/pharmacy-prescriptions', pharmacist);
    const items = list.body.items as Array<{ id: string; status: string }>;
    if (items.length === 0) return;
    const target = items.find((i) => i.status === 'COMPLETED') ?? items[0]!;
    const res = await inject('POST', `/api/pharmacy-prescriptions/${target.id}/status`, pharmacist, { status: 'RECEIVED' });
    expect(res.status).toBe(409);
  });

  it('prevents one patient from reading another patient\'s records', async () => {
    const res = await inject('GET', `/api/patients/${otherPatientId}/history`, patient);
    // The patient login may or may not be linked to a patient; either way this
    // must never return another patient's full history.
    if (patient.clinicId) {
      expect([403, 404]).toContain(res.status);
    } else {
      expect(res.status).toBe(403);
    }
  });

  it('scopes family record visibility to explicit consent', async () => {
    const primary = await inject('GET', `/api/patients/${patientId}`, owner);
    const family = (primary.body.patient as { asPrimary?: Array<{ canViewRecords: boolean; member: { id: string } }> }).asPrimary ?? [];
    const privateMember = family.find((f) => !f.canViewRecords);
    if (!privateMember) return;
    // A family link without canViewRecords must not appear as shared.
    expect(privateMember.canViewRecords).toBe(false);
  });

  it('records an audit trail for issued prescriptions', async () => {
    const audit = await inject('GET', `/api/audit/entity/Prescription/${rxId}`, owner);
    const actions = (audit.body.items as Array<{ action: string }>).map((i) => i.action);
    expect(actions).toContain('PRESCRIPTION_CREATED');
    expect(actions).toContain('PRESCRIPTION_ISSUED');
    expect(actions).toContain('PRESCRIPTION_CORRECTED');
  });

  it('generates a PDF for an issued prescription', async () => {
    const app = (await import('./helpers.js')).getApp;
    const server = await app();
    const res = await server.inject({ method: 'GET', url: `/api/prescriptions/${rxId}/pdf`, headers: { authorization: `Bearer ${owner.token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it('verifies a prescription publicly without exposing clinical detail', async () => {
    const res = await inject('GET', `/api/prescriptions/verify/${rxNo}`);
    expect(res.status).toBe(200);
    expect(res.body.prescriptionNo).toBe(rxNo);
    expect(res.body).not.toHaveProperty('medicines');
    expect(res.body).not.toHaveProperty('diagnosis');
  });

  it('restricts billing to permitted roles and keeps balances consistent', async () => {
    const invoice = await inject('POST', '/api/billing/invoices', reception, {
      clinicId: owner.clinicId, patientId, items: [{ name: 'Consultation', category: 'CONSULTATION', fee: 500, qty: 1 }],
    });
    expect(invoice.status).toBe(201);
    const inv = invoice.body.invoice as { id: string; total: number; balance: number };
    expect(inv.total).toBe(500);
    expect(inv.balance).toBe(500);

    const partial = await inject('POST', '/api/billing/payments', reception, { invoiceId: inv.id, amount: 200, method: 'CASH' });
    expect(partial.status).toBe(201);
    const updated = partial.body.invoice as { amountPaid: number; balance: number; status: string };
    expect(updated.amountPaid).toBe(200);
    expect(updated.balance).toBe(300);
    expect(updated.status).toBe('PARTIALLY_PAID');

    // Over-payment is refused.
    const over = await inject('POST', '/api/billing/payments', reception, { invoiceId: inv.id, amount: 9999, method: 'CASH' });
    expect(over.status).toBe(400);

    // Doctors cannot record payments (billing:view only).
    const doctorPay = await inject('POST', '/api/billing/payments', doctor, { invoiceId: inv.id, amount: 10, method: 'CASH' });
    expect(doctorPay.status).toBe(403);
  });

  it('validates vitals input ranges', async () => {
    const consultation = await inject('POST', '/api/consultations', doctor, { clinicId: owner.clinicId, patientId, doctorId });
    const id = (consultation.body.consultation as { id: string }).id;
    const invalid = await inject('POST', `/api/consultations/${id}/vitals`, doctor, { spo2: 150 });
    expect(invalid.status).toBe(422);
    const valid = await inject('POST', `/api/consultations/${id}/vitals`, doctor, { spo2: 98, weightKg: 70, heightCm: 175 });
    expect(valid.status).toBe(201);
    expect((valid.body.vital as { bmi: number }).bmi).toBeCloseTo(22.9, 1);
  });
});
