import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../shared/prisma.js';
import { config } from '../../shared/config.js';
import { AppError } from '../../shared/errors.js';
import { PRESCRIPTION_STATUS, PRESCRIPTION_VERSION_STATUS } from '../../shared/constants.js';

export interface MedicineInput {
  medicineId?: string | null;
  name: string;
  genericName?: string | null;
  strength?: string | null;
  form?: string | null;
  dose?: string | null;
  frequency?: string | null;
  route?: string | null;
  duration?: string | null;
  instructions?: string | null;
  foodRelation?: string | null;
  quantity?: string | null;
  isControlled?: boolean;
  sortOrder?: number;
}

export interface VersionContentInput {
  diagnosis?: string | null;
  notes?: string | null;
  advice?: string | null;
  followUpDate?: Date | null;
  inkStrokesJson?: string | null;
  inkImagePath?: string | null;
  voiceTranscript?: string | null;
  signatureUrl?: string | null;
  medicines?: MedicineInput[];
  notesList?: Array<{ type?: string; text: string }>;
  attachmentDocumentIds?: string[];
}

/**
 * Deterministic hash over the clinically significant content of a version.
 * Stored on issue so tampering can be detected and versions can be compared.
 */
export function computeContentHash(input: VersionContentInput): string {
  const canonical = {
    diagnosis: input.diagnosis ?? null,
    notes: input.notes ?? null,
    advice: input.advice ?? null,
    followUpDate: input.followUpDate ? input.followUpDate.toISOString() : null,
    voiceTranscript: input.voiceTranscript ?? null,
    hasInk: Boolean(input.inkStrokesJson || input.inkImagePath),
    medicines: (input.medicines ?? []).map((m) => ({
      name: m.name,
      strength: m.strength ?? null,
      form: m.form ?? null,
      dose: m.dose ?? null,
      frequency: m.frequency ?? null,
      route: m.route ?? null,
      duration: m.duration ?? null,
      instructions: m.instructions ?? null,
      foodRelation: m.foodRelation ?? null,
      quantity: m.quantity ?? null,
    })),
    notesList: (input.notesList ?? []).map((n) => ({ type: n.type ?? 'GENERAL', text: n.text })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function storagePathFor(...segments: string[]): string {
  return path.join(config.STORAGE_DIR, ...segments);
}

export async function ensureStorageDir(...segments: string[]): Promise<string> {
  const dir = storagePathFor(...segments);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function writeFileBuffer(relativePath: string, data: Buffer | Uint8Array): Promise<string> {
  const abs = storagePathFor(relativePath);
  return fs.mkdir(path.dirname(abs), { recursive: true }).then(() => fs.writeFile(abs, data)).then(() => abs);
}

export async function readFileBuffer(relativePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(storagePathFor(relativePath));
  } catch {
    throw AppError.notFound('File not found');
  }
}
/** Loads a prescription with its full version history, newest first. */
export async function loadPrescription(id: string) {
  const rx = await prisma.prescription.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, name: true, patientCode: true, dateOfBirth: true, gender: true, mobile: true, allergies: true, bloodGroup: true } },
      doctor: true,
      clinic: true,
      consultation: { select: { id: true, chiefComplaint: true, diagnosis: true } },
      versions: {
        orderBy: { version: 'desc' },
        include: {
          medicines: { orderBy: { sortOrder: 'asc' } },
          notesList: true,
          attachments: { include: { medicalDocument: { select: { id: true, title: true, fileName: true, mimeType: true, category: true } } } },
        },
      },
      shares: { include: { pharmacy: { select: { id: true, name: true, type: true } } } },
      pharmacyPrescriptions: { include: { pharmacy: { select: { id: true, name: true, type: true } } } },
    },
  });
  if (!rx) throw AppError.notFound('Prescription not found');
  return rx;
}

/** Returns the version currently in effect (latest ISSUED, else latest overall). */
export function currentVersion<T extends { status: string }>(versions: T[]): T | null {
  return versions.find((v) => v.status === PRESCRIPTION_VERSION_STATUS.ISSUED) ?? versions[0] ?? null;
}

export function assertVersionEditable(status: string): void {
  if (status !== PRESCRIPTION_VERSION_STATUS.DRAFT && status !== PRESCRIPTION_VERSION_STATUS.REVIEW) {
    throw AppError.conflict('This prescription version has been issued and cannot be edited. Create a corrected version instead.');
  }
}

export function assertPrescriptionMutable(status: string): void {
  if (status === PRESCRIPTION_STATUS.CANCELLED) throw AppError.conflict('This prescription has been cancelled');
}

export async function generateAndStorePdf(
  input: import('./pdf.js').PrescriptionPdfInput,
  relativePath: string,
): Promise<string> {
  const { buildPrescriptionPdf } = await import('./pdf.js');
  const bytes = await buildPrescriptionPdf(input);
  await writeFileBuffer(relativePath, bytes);
  return relativePath;
}
