/** Domain types shared across the client. Mirrors the API DTOs. */

export type RoleName =
  | 'SUPER_ADMIN' | 'CLINIC_OWNER' | 'DOCTOR' | 'RECEPTIONIST'
  | 'NURSE' | 'CLINIC_STAFF' | 'PHARMACIST' | 'PATIENT';

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  avatarUrl?: string | null;
  roles: RoleName[];
  permissions: string[];
  scopes: {
    clinicIds: string[];
    doctorIds: string[];
    pharmacyIds: string[];
    patientIds: string[];
  };
}

export interface Clinic {
  id: string; name: string; slug: string; logoUrl?: string | null; address?: string | null;
  phone?: string | null; email?: string | null; registrationNo?: string | null; licenseNo?: string | null;
  timings?: string | null; emergencyContact?: string | null; website?: string | null;
  whatsappNumber?: string | null; consultationFee: number; currency: string; timezone: string;
  medicalShopEnabled: boolean;
}

export interface Doctor {
  id: string; clinicId: string; userId?: string | null; name: string; photoUrl?: string | null;
  specialization?: string | null; qualification?: string | null; registrationNo?: string | null;
  phone?: string | null; email?: string | null; consultationFee: number; followUpFee: number;
  timings?: string | null; availableDays?: string | null; prescriptionHeader?: string | null;
  prescriptionFooter?: string | null; defaultMedicineInstructions?: string | null;
  defaultFollowUpDays?: number | null; voiceInputEnabled: boolean; inkPrescriptionEnabled: boolean;
  whatsappSharingEnabled: boolean; patientNotificationEnabled: boolean; isActive: boolean;
}

export interface Patient {
  id: string; clinicId: string; patientCode: string; name: string; dateOfBirth?: string | null;
  gender?: string | null; mobile?: string | null; email?: string | null; address?: string | null;
  emergencyContact?: string | null; bloodGroup?: string | null; allergies?: string | null;
  existingConditions?: string | null; medicalHistory?: string | null; currentMedications?: string | null;
  createdAt?: string;
}

export interface Appointment {
  id: string; clinicId: string; patientId: string; doctorId: string; scheduledAt: string;
  durationMin: number; reason?: string | null; type: string; status: string; source: string;
  notes?: string | null;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode' | 'mobile' | 'dateOfBirth' | 'gender'>;
  doctor?: Pick<Doctor, 'id' | 'name' | 'specialization'>;
  queueToken?: QueueToken | null;
}

export interface QueueToken {
  id: string; clinicId: string; doctorId: string; patientId: string; appointmentId?: string | null;
  tokenNumber: number; queueDate: string; status: string; calledAt?: string | null;
  completedAt?: string | null; notes?: string | null;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode' | 'mobile'>;
  doctor?: Pick<Doctor, 'id' | 'name'>;
}

export interface Vital {
  id: string; temperature?: number | null; bpSystolic?: number | null; bpDiastolic?: number | null;
  pulse?: number | null; spo2?: number | null; weightKg?: number | null; heightCm?: number | null;
  bmi?: number | null; respiratoryRate?: number | null; extraJson?: string | null; recordedAt: string;
}

export interface Consultation {
  id: string; clinicId: string; patientId: string; doctorId: string; appointmentId?: string | null;
  status: string; chiefComplaint?: string | null; symptoms?: string | null; history?: string | null;
  examination?: string | null; diagnosis?: string | null; doctorNotes?: string | null;
  advice?: string | null; followUpDate?: string | null; startedAt: string; completedAt?: string | null;
  patient?: Patient;
  doctor?: Pick<Doctor, 'id' | 'name' | 'specialization' | 'qualification' | 'registrationNo'>;
  vitals?: Vital[];
  diagnoses?: Array<{ id: string; code?: string | null; description: string; type: string; notes?: string | null }>;
  investigations?: Array<{ id: string; type: string; name: string; instructions?: string | null; status: string; resultSummary?: string | null }>;
  procedures?: Array<{ id: string; name: string; notes?: string | null; fee: number }>;
  prescriptions?: Prescription[];
  followUps?: FollowUp[];
}

export interface PrescriptionMedicine {
  id?: string; medicineId?: string | null; name: string; genericName?: string | null;
  strength?: string | null; form?: string | null; dose?: string | null; frequency?: string | null;
  route?: string | null; duration?: string | null; instructions?: string | null;
  foodRelation?: string | null; quantity?: string | null; isControlled?: boolean; sortOrder?: number;
}

export interface PrescriptionVersion {
  id: string; version: number; status: string; diagnosis?: string | null; notes?: string | null;
  advice?: string | null; followUpDate?: string | null; inkImagePath?: string | null;
  inkStrokesJson?: string | null; voiceTranscript?: string | null; signatureUrl?: string | null;
  pdfPath?: string | null; contentHash?: string | null; issuedAt?: string | null;
  supersededByVersion?: number | null; createdAt: string;
  medicines: PrescriptionMedicine[];
  notesList: Array<{ id: string; type: string; text: string }>;
  attachments?: Array<{ id: string; kind: string; medicalDocument: { id: string; title: string; fileName: string; mimeType: string; category: string } }>;
}

export interface Prescription {
  id: string; clinicId: string; patientId: string; doctorId: string; consultationId?: string | null;
  prescriptionNo: string; status: string; currentVersionId?: string | null; issuedAt?: string | null;
  createdAt: string; updatedAt: string;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode' | 'dateOfBirth' | 'gender' | 'mobile' | 'allergies' | 'bloodGroup'>;
  doctor?: Doctor;
  clinic?: Clinic;
  versions: PrescriptionVersion[];
  shares?: Array<{ id: string; targetType: string; channel: string; createdAt: string; viewedAt?: string | null; pharmacy?: { id: string; name: string; type: string } | null }>;
  pharmacyPrescriptions?: Array<{ id: string; status: string; pharmacy: { id: string; name: string; type: string } }>;
}

export interface Pharmacy {
  id: string; name: string; type: string; clinicId?: string | null; phone?: string | null;
  email?: string | null; address?: string | null; licenseNo?: string | null;
  isEganParticipating: boolean; isActive: boolean;
  users?: Array<{ id: string; role: string; user: { id: string; fullName: string; email: string } }>;
}

export interface PharmacyPrescription {
  id: string; pharmacyId: string; prescriptionId: string; status: string; receivedAt: string;
  reviewedAt?: string | null; clarificationNote?: string | null; rejectionReason?: string | null;
  readyAt?: string | null; completedAt?: string | null;
  pharmacy?: Pick<Pharmacy, 'id' | 'name'>;
  prescription?: Prescription;
  order?: PharmacyOrder | null;
}

export interface PharmacyOrder {
  id: string; pharmacyId: string; pharmacyPrescriptionId: string; patientId: string;
  status: string; fulfillment: string; itemsJson?: string | null; totalAmount: number; createdAt: string;
}

export interface Invoice {
  id: string; clinicId: string; patientId: string; invoiceNo: string; consultationId?: string | null;
  itemsJson: string; subtotal: number; discount: number; tax: number; total: number;
  amountPaid: number; balance: number; status: string; createdAt: string;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode' | 'mobile'>;
  payments?: Payment[];
  clinic?: Pick<Clinic, 'id' | 'name' | 'address' | 'phone' | 'currency'>;
}

export interface Payment {
  id: string; clinicId: string; invoiceId: string; patientId: string; amount: number;
  method: string; status: string; reference?: string | null; refundedAmount: number;
  notes?: string | null; createdAt: string;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode'>;
  invoice?: { invoiceNo: string };
}

export interface FollowUp {
  id: string; clinicId: string; patientId: string; doctorId: string; dueDate: string;
  instructions?: string | null; status: string; reminderSentAt?: string | null;
  patient?: Pick<Patient, 'id' | 'name' | 'patientCode' | 'mobile'>;
  doctor?: Pick<Doctor, 'id' | 'name'>;
}

export interface MedicalDocument {
  id: string; title: string; category: string; fileName: string; mimeType: string;
  size: number; isConfidential: boolean; createdAt: string;
}

export interface AppNotification {
  id: string; type: string; title: string; body: string; channel: string;
  entityType?: string | null; entityId?: string | null; dataJson?: string | null;
  isRead: boolean; readAt?: string | null; createdAt: string;
}

export interface AuditEntry {
  id: string; action: string; entityType: string; entityId?: string | null;
  actorName?: string | null; metadataJson?: string | null; ipAddress?: string | null;
  createdAt: string; user?: { id: string; fullName: string; email: string } | null;
}

export interface DashboardData {
  today: { appointments: number; waiting: number; completed: number; followUps: number; revenue: number };
  recentPatients: Array<{ id: string; name: string; patientCode: string; createdAt: string }>;
  recentPrescriptions: Array<{ id: string; prescriptionNo: string; status: string; createdAt: string; patient: { name: string }; doctor: { name: string } }>;
  pendingPayments: { count: number; amount: number };
  medicalShop: { newPrescriptionRequests: number } | null;
}

export interface Paginated<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
