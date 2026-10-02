/**
 * System roles. A user may hold multiple roles (e.g. a clinic owner who is also
 * a doctor), so authorization is expressed as a union of role permissions.
 */
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  CLINIC_OWNER: 'CLINIC_OWNER',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
  NURSE: 'NURSE',
  CLINIC_STAFF: 'CLINIC_STAFF',
  PHARMACIST: 'PHARMACIST',
  PATIENT: 'PATIENT',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: RoleName[] = Object.values(ROLES);

/**
 * Permission codes. Format: <domain>:<action>.
 * Kept granular so least-privilege can be enforced per resource.
 */
export const PERMISSIONS = {
  // Clinic administration
  CLINIC_VIEW: 'clinic:view',
  CLINIC_MANAGE: 'clinic:manage',
  CLINIC_SETTINGS_MANAGE: 'clinic:settings:manage',
  STAFF_VIEW: 'staff:view',
  STAFF_MANAGE: 'staff:manage',

  // Doctors
  DOCTOR_VIEW: 'doctor:view',
  DOCTOR_MANAGE: 'doctor:manage',

  // Patients
  PATIENT_VIEW: 'patient:view',
  PATIENT_CREATE: 'patient:create',
  PATIENT_UPDATE: 'patient:update',
  PATIENT_DELETE: 'patient:delete',
  PATIENT_FAMILY_MANAGE: 'patient:family:manage',

  // Appointments & queue
  APPOINTMENT_VIEW: 'appointment:view',
  APPOINTMENT_MANAGE: 'appointment:manage',
  QUEUE_VIEW: 'queue:view',
  QUEUE_MANAGE: 'queue:manage',

  // Clinical
  CONSULTATION_VIEW: 'consultation:view',
  CONSULTATION_MANAGE: 'consultation:manage',
  VITALS_VIEW: 'vitals:view',
  VITALS_MANAGE: 'vitals:manage',
  PRESCRIPTION_VIEW: 'prescription:view',
  PRESCRIPTION_CREATE: 'prescription:create',
  PRESCRIPTION_ISSUE: 'prescription:issue',
  PRESCRIPTION_CORRECT: 'prescription:correct',
  PRESCRIPTION_SHARE: 'prescription:share',

  // Documents
  DOCUMENT_VIEW: 'document:view',
  DOCUMENT_UPLOAD: 'document:upload',
  DOCUMENT_DELETE: 'document:delete',

  // Billing & payments
  BILLING_VIEW: 'billing:view',
  BILLING_MANAGE: 'billing:manage',
  PAYMENT_VIEW: 'payment:view',
  PAYMENT_MANAGE: 'payment:manage',
  PAYMENT_REFUND: 'payment:refund',

  // Pharmacy
  PHARMACY_VIEW: 'pharmacy:view',
  PHARMACY_MANAGE: 'pharmacy:manage',
  PHARMACY_PRESCRIPTION_VIEW: 'pharmacy:prescription:view',
  PHARMACY_PRESCRIPTION_PROCESS: 'pharmacy:prescription:process',

  // Notifications
  NOTIFICATION_VIEW: 'notification:view',
  NOTIFICATION_MANAGE: 'notification:manage',

  // Reports & audit
  REPORT_VIEW: 'report:view',
  AUDIT_VIEW: 'audit:view',

  // Patient portal (self-service)
  SELF_VIEW: 'self:view',
  SELF_MANAGE: 'self:manage',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

/**
 * Default role → permission mapping. Mirrors the RBAC rules in the product spec:
 *  - a doctor does NOT automatically receive pharmacy permissions
 *  - a pharmacist does NOT receive unrelated clinical administration access
 */
export const ROLE_PERMISSIONS: Record<RoleName, PermissionCode[]> = {
  SUPER_ADMIN: Object.values(P),

  CLINIC_OWNER: [
    P.CLINIC_VIEW, P.CLINIC_MANAGE, P.CLINIC_SETTINGS_MANAGE,
    P.STAFF_VIEW, P.STAFF_MANAGE,
    P.DOCTOR_VIEW, P.DOCTOR_MANAGE,
    P.PATIENT_VIEW, P.PATIENT_CREATE, P.PATIENT_UPDATE, P.PATIENT_DELETE, P.PATIENT_FAMILY_MANAGE,
    P.APPOINTMENT_VIEW, P.APPOINTMENT_MANAGE,
    P.QUEUE_VIEW, P.QUEUE_MANAGE,
    P.CONSULTATION_VIEW, P.CONSULTATION_MANAGE,
    P.VITALS_VIEW, P.VITALS_MANAGE,
    P.PRESCRIPTION_VIEW, P.PRESCRIPTION_CREATE, P.PRESCRIPTION_ISSUE, P.PRESCRIPTION_CORRECT, P.PRESCRIPTION_SHARE,
    P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD, P.DOCUMENT_DELETE,
    P.BILLING_VIEW, P.BILLING_MANAGE, P.PAYMENT_VIEW, P.PAYMENT_MANAGE, P.PAYMENT_REFUND,
    P.PHARMACY_VIEW, P.PHARMACY_MANAGE, P.PHARMACY_PRESCRIPTION_VIEW,
    P.NOTIFICATION_VIEW, P.NOTIFICATION_MANAGE,
    P.REPORT_VIEW, P.AUDIT_VIEW,
  ],

  DOCTOR: [
    P.CLINIC_VIEW,
    P.DOCTOR_VIEW,
    P.PATIENT_VIEW, P.PATIENT_CREATE, P.PATIENT_UPDATE, P.PATIENT_FAMILY_MANAGE,
    P.APPOINTMENT_VIEW, P.APPOINTMENT_MANAGE,
    P.QUEUE_VIEW, P.QUEUE_MANAGE,
    P.CONSULTATION_VIEW, P.CONSULTATION_MANAGE,
    P.VITALS_VIEW, P.VITALS_MANAGE,
    P.PRESCRIPTION_VIEW, P.PRESCRIPTION_CREATE, P.PRESCRIPTION_ISSUE, P.PRESCRIPTION_CORRECT, P.PRESCRIPTION_SHARE,
    P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD,
    P.BILLING_VIEW,
    P.NOTIFICATION_VIEW,
    P.REPORT_VIEW,
    // NOTE: no pharmacy:* permissions. Doctors must not gain pharmacy access.
  ],

  RECEPTIONIST: [
    P.CLINIC_VIEW,
    P.DOCTOR_VIEW,
    P.PATIENT_VIEW, P.PATIENT_CREATE, P.PATIENT_UPDATE, P.PATIENT_FAMILY_MANAGE,
    P.APPOINTMENT_VIEW, P.APPOINTMENT_MANAGE,
    P.QUEUE_VIEW, P.QUEUE_MANAGE,
    P.VITALS_VIEW,
    P.PRESCRIPTION_VIEW,
    P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD,
    P.BILLING_VIEW, P.BILLING_MANAGE, P.PAYMENT_VIEW, P.PAYMENT_MANAGE,
    P.NOTIFICATION_VIEW,
  ],

  NURSE: [
    P.CLINIC_VIEW,
    P.DOCTOR_VIEW,
    P.PATIENT_VIEW, P.PATIENT_UPDATE,
    P.APPOINTMENT_VIEW,
    P.QUEUE_VIEW, P.QUEUE_MANAGE,
    P.CONSULTATION_VIEW,
    P.VITALS_VIEW, P.VITALS_MANAGE,
    P.PRESCRIPTION_VIEW,
    P.DOCUMENT_VIEW, P.DOCUMENT_UPLOAD,
    P.NOTIFICATION_VIEW,
  ],

  CLINIC_STAFF: [
    P.CLINIC_VIEW,
    P.DOCTOR_VIEW,
    P.PATIENT_VIEW,
    P.APPOINTMENT_VIEW,
    P.QUEUE_VIEW,
    P.NOTIFICATION_VIEW,
  ],

  PHARMACIST: [
    P.CLINIC_VIEW,
    P.PHARMACY_VIEW, P.PHARMACY_PRESCRIPTION_VIEW, P.PHARMACY_PRESCRIPTION_PROCESS,
    P.PRESCRIPTION_VIEW, // only for prescriptions explicitly shared with their pharmacy
    P.NOTIFICATION_VIEW,
    // NOTE: no patient administration, billing, or clinical write access.
  ],

  PATIENT: [
    P.SELF_VIEW, P.SELF_MANAGE,
    P.PRESCRIPTION_VIEW,
    // Patients may share (e.g. via WhatsApp/PDF) prescriptions they can access.
    // assertPrescriptionAccess limits this to their own records and any family
    // records explicitly shared with them.
    P.PRESCRIPTION_SHARE,
    P.NOTIFICATION_VIEW,
  ],
};
