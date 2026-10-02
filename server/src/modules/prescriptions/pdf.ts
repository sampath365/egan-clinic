import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { config } from '../../shared/config.js';
import { writeFileBuffer } from './service.js';

export interface PrescriptionPdfInput {
  clinic: { name: string; address?: string | null; phone?: string | null; email?: string | null; logoUrl?: string | null };
  doctor: {
    name: string;
    specialization?: string | null;
    qualification?: string | null;
    registrationNo?: string | null;
    prescriptionHeader?: string | null;
    prescriptionFooter?: string | null;
    signatureUrl?: string | null;
  };
  patient: { name: string; patientCode: string; age?: string | null; gender?: string | null; mobile?: string | null };
  prescriptionNo: string;
  version: number;
  issuedAt: Date | null;
  diagnosis?: string | null;
  notes?: string | null;
  advice?: string | null;
  followUpDate?: Date | null;
  medicines: Array<{
    name: string; strength?: string | null; form?: string | null; dose?: string | null;
    frequency?: string | null; route?: string | null; duration?: string | null;
    instructions?: string | null; foodRelation?: string | null; quantity?: string | null;
  }>;
  investigations: string[];
  inkImagePath?: string | null;
}

const INK = rgb(0.09, 0.13, 0.22);
const MUTED = rgb(0.42, 0.47, 0.56);
const ACCENT = rgb(0.05, 0.45, 0.42);
const LINE = rgb(0.85, 0.87, 0.9);

function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = `${line} ${w}`.trim();
    }
  }
  if (line) lines.push(line.trim());
  return lines;
}

/**
 * Builds the prescription PDF entirely in memory. The output is deterministic
 * for a given version so the stored copy matches what the doctor signed.
 */
export async function buildPrescriptionPdf(input: PrescriptionPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 48;
  let y = height - margin;

  const text = (s: string, opts: { x?: number; size?: number; bold?: boolean; color?: typeof INK } = {}) => {
    page.drawText(s, {
      x: opts.x ?? margin,
      y,
      size: opts.size ?? 10,
      font: opts.bold ? bold : font,
      color: opts.color ?? INK,
    });
  };

  // Header band
  page.drawRectangle({ x: 0, y: height - 96, width, height: 96, color: rgb(0.96, 0.98, 0.98) });
  text(input.clinic.name, { size: 18, bold: true });
  y -= 18;
  const clinicMeta = [input.clinic.address, input.clinic.phone, input.clinic.email].filter(Boolean).join('  •  ');
  if (clinicMeta) { text(clinicMeta, { size: 9, color: MUTED }); y -= 14; }
  if (input.doctor.prescriptionHeader) {
    for (const l of wrap(input.doctor.prescriptionHeader, 95)) { text(l, { size: 9, color: MUTED }); y -= 12; }
  }
  y = height - 118;

  // Doctor block
  text(`Dr. ${input.doctor.name}`, { size: 13, bold: true });
  y -= 15;
  const qual = [input.doctor.qualification, input.doctor.specialization].filter(Boolean).join(', ');
  if (qual) { text(qual, { size: 9.5, color: MUTED }); y -= 13; }
  if (input.doctor.registrationNo) { text(`Reg. No: ${input.doctor.registrationNo}`, { size: 9.5, color: MUTED }); y -= 13; }

  // Patient + Rx meta (two columns)
  const metaTop = y - 6;
  page.drawRectangle({ x: margin, y: metaTop - 62, width: width - margin * 2, height: 68, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) });
  const col2 = width / 2 + 10;
  let ly = metaTop - 18;
  page.drawText('Patient', { x: margin + 12, y: ly, size: 8.5, font: bold, color: MUTED });
  page.drawText(input.patient.name, { x: margin + 12, y: ly - 14, size: 11, font: bold, color: INK });
  page.drawText(`ID: ${input.patient.patientCode}`, { x: margin + 12, y: ly - 28, size: 9, font, color: MUTED });
  const ageGender = [input.patient.age ? `${input.patient.age}` : null, input.patient.gender].filter(Boolean).join(' / ');
  if (ageGender) page.drawText(ageGender, { x: margin + 12, y: ly - 41, size: 9, font, color: MUTED });

  page.drawText('Prescription', { x: col2, y: ly, size: 8.5, font: bold, color: MUTED });
  page.drawText(input.prescriptionNo, { x: col2, y: ly - 14, size: 11, font: bold, color: ACCENT });
  page.drawText(`Version ${input.version}`, { x: col2, y: ly - 28, size: 9, font, color: MUTED });
  page.drawText(input.issuedAt ? input.issuedAt.toLocaleString() : 'Draft', { x: col2, y: ly - 41, size: 9, font, color: MUTED });
  y = metaTop - 84;

  const section = (title: string) => {
    if (y < 120) { return; }
    text(title.toUpperCase(), { size: 9, bold: true, color: ACCENT });
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.8, color: LINE });
    y -= 16;
  };

  if (input.diagnosis) {
    section('Diagnosis');
    for (const l of wrap(input.diagnosis, 100)) { text(l, { size: 10 }); y -= 14; }
    y -= 6;
  }

  section('Medicines');
  if (input.medicines.length === 0) {
    text('No structured medicines were entered on this version.', { size: 9.5, color: MUTED });
    y -= 16;
  }
  for (const [i, m] of input.medicines.entries()) {
    if (y < 130) break;
    const title = `${i + 1}. ${m.name}${m.strength ? ` ${m.strength}` : ''}${m.form ? ` (${m.form.toLowerCase()})` : ''}`;
    text(title, { size: 10.5, bold: true });
    y -= 13;
    const parts = [
      m.dose ? `Dose: ${m.dose}` : null,
      m.frequency ? `Frequency: ${m.frequency}` : null,
      m.route ? `Route: ${m.route}` : null,
      m.duration ? `Duration: ${m.duration}` : null,
      m.foodRelation && m.foodRelation !== 'NA' ? `Food: ${m.foodRelation.replace('_', ' ').toLowerCase()}` : null,
      m.quantity ? `Qty: ${m.quantity}` : null,
    ].filter(Boolean) as string[];
    for (const l of wrap(parts.join('   •   '), 110)) { text(l, { size: 9, color: MUTED }); y -= 12; }
    if (m.instructions) { for (const l of wrap(`Instructions: ${m.instructions}`, 110)) { text(l, { size: 9, color: MUTED }); y -= 12; } }
    y -= 6;
  }

  if (input.investigations.length > 0) {
    section('Investigations');
    for (const inv of input.investigations) { text(`• ${inv}`, { size: 10 }); y -= 14; }
    y -= 6;
  }

  if (input.advice) {
    section('Advice');
    for (const l of wrap(input.advice, 100)) { text(l, { size: 10 }); y -= 14; }
    y -= 6;
  }

  if (input.followUpDate) {
    section('Follow-up');
    text(input.followUpDate.toLocaleDateString(), { size: 10, bold: true });
    y -= 16;
  }

  if (input.notes) {
    section('Doctor notes');
    for (const l of wrap(input.notes, 100)) { text(l, { size: 9.5, color: MUTED }); y -= 13; }
  }

  // Signature + QR verification
  const sigY = Math.max(y, 150);
  page.drawLine({ start: { x: margin, y: sigY + 34 }, end: { x: margin + 190, y: sigY + 34 }, thickness: 0.8, color: LINE });
  page.drawText(`Dr. ${input.doctor.name}`, { x: margin, y: sigY + 22, size: 9.5, font: bold, color: INK });
  page.drawText('Digital signature', { x: margin, y: sigY + 10, size: 8.5, font, color: MUTED });

  const verifyUrl = `${config.PUBLIC_BASE_URL}/verify/${input.prescriptionNo}`;
  try {
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 160 });
    const qrPng = await pdf.embedPng(qrDataUrl);
    page.drawImage(qrPng, { x: width - margin - 74, y: sigY - 6, width: 74, height: 74 });
    page.drawText('Scan to verify', { x: width - margin - 74, y: sigY - 18, size: 7.5, font, color: MUTED });
  } catch {
    // QR generation is optional; never fail PDF generation over it.
  }

  const footerText = input.doctor.prescriptionFooter ?? 'This prescription is valid only for the named patient.';
  const footerLines = wrap(footerText, 110);
  let fy = 46;
  for (const l of footerLines.slice(0, 2)) {
    page.drawText(l, { x: margin, y: fy, size: 8, font, color: MUTED });
    fy -= 10;
  }
  page.drawText(`Generated by EGAN Clinic • ${config.PUBLIC_BASE_URL}`, { x: margin, y: 22, size: 7.5, font, color: MUTED });

  return pdf.save();
}

/** Generates the PDF and stores it, returning the storage-relative path. */
export async function generateAndStorePdf(input: PrescriptionPdfInput, relativePath: string): Promise<string> {
  const bytes = await buildPrescriptionPdf(input);
  await writeFileBuffer(relativePath, bytes);
  return relativePath;
}
