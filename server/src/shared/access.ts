import type { FastifyRequest } from 'fastify';
import { prisma } from '../shared/prisma.js';
import { AppError } from '../shared/errors.js';
import { isSuperAdmin, type AuthUser } from '../plugins/auth.js';

/**
 * Authorization scoping helpers. Every patient-scoped resource must pass
 * through one of these checks — never rely on knowing an id alone.
 */

export function assertClinicAccess(auth: AuthUser | undefined, clinicId: string): void {
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) return;
  if (!auth.clinicIds.includes(clinicId)) {
    throw AppError.forbidden('You do not have access to this clinic');
  }
}

export function assertAnyClinicAccess(auth: AuthUser | undefined, clinicIds: string[]): void {
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) return;
  if (!clinicIds.some((id) => auth.clinicIds.includes(id))) {
    throw AppError.forbidden('You do not have access to this clinic');
  }
}

/**
 * Patient access rules:
 *  - clinic staff/doctors with access to the patient's clinic may view records
 *  - a patient user may view their own record, and family members' records only
 *    when the family link explicitly grants `canViewRecords`
 */
export async function assertPatientAccess(
  auth: AuthUser | undefined,
  patientId: string,
  opts: { write?: boolean } = {},
): Promise<{ clinicId: string }> {
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) {
    const p = await prisma.patient.findUnique({ where: { id: patientId }, select: { clinicId: true } });
    if (!p) throw AppError.notFound('Patient not found');
    return { clinicId: p.clinicId };
  }

  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, clinicId: true, userId: true },
  });
  if (!patient) throw AppError.notFound('Patient not found');

  if (auth.clinicIds.includes(patient.clinicId)) {
    return { clinicId: patient.clinicId };
  }

  // Patient self-service scope.
  if (auth.patientIds.includes(patientId)) return { clinicId: patient.clinicId };

  if (!opts.write && auth.patientIds.length > 0) {
    const familyLink = await prisma.patientFamily.findFirst({
      where: {
        memberPatientId: patientId,
        canViewRecords: true,
        primaryPatientId: { in: auth.patientIds },
      },
    });
    if (familyLink) return { clinicId: patient.clinicId };
  }

  throw AppError.forbidden('You do not have access to this patient record');
}

export async function assertDoctorAccess(auth: AuthUser | undefined, doctorId: string): Promise<void> {
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) return;
  if (auth.doctorIds.includes(doctorId)) return;
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { clinicId: true } });
  if (!doctor) throw AppError.notFound('Doctor not found');
  if (!auth.clinicIds.includes(doctor.clinicId)) {
    throw AppError.forbidden('You do not have access to this doctor');
  }
}

/**
 * Prescription access. A pharmacist may only reach a prescription that has been
 * explicitly shared with one of their pharmacies.
 */
export async function assertPrescriptionAccess(
  auth: AuthUser | undefined,
  prescriptionId: string,
): Promise<{ clinicId: string; patientId: string }> {
  if (!auth) throw AppError.unauthorized();
  const rx = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    select: { id: true, clinicId: true, patientId: true, doctorId: true },
  });
  if (!rx) throw AppError.notFound('Prescription not found');

  if (isSuperAdmin(auth)) return { clinicId: rx.clinicId, patientId: rx.patientId };
  if (auth.clinicIds.includes(rx.clinicId)) return { clinicId: rx.clinicId, patientId: rx.patientId };
  if (auth.patientIds.includes(rx.patientId)) return { clinicId: rx.clinicId, patientId: rx.patientId };

  if (auth.pharmacyIds.length > 0) {
    const share = await prisma.prescriptionShare.findFirst({
      where: { prescriptionId, pharmacyId: { in: auth.pharmacyIds } },
      select: { id: true },
    });
    if (share) return { clinicId: rx.clinicId, patientId: rx.patientId };
  }

  throw AppError.forbidden('You do not have access to this prescription');
}

export function assertPharmacyAccess(auth: AuthUser | undefined, pharmacyId: string): void {
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) return;
  if (!auth.pharmacyIds.includes(pharmacyId)) {
    throw AppError.forbidden('You do not have access to this pharmacy');
  }
}

export async function getClinicIdForRequest(req: FastifyRequest): Promise<string> {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();
  if (isSuperAdmin(auth)) {
    const q = req.query as { clinicId?: string };
    if (q?.clinicId) return q.clinicId;
  }
  if (auth.clinicIds.length === 0) throw AppError.forbidden('No clinic is associated with your account');
  return auth.clinicIds[0]!;
}
