import { prisma } from '../../shared/prisma.js';

/**
 * Generates the next sequential patient code for a clinic, e.g. EGAN-P-0007.
 * The counter is derived from existing rows so it survives restarts and does
 * not require a separate sequence table.
 */
export async function nextPatientCode(clinicId: string): Promise<string> {
  const count = await prisma.patient.count({ where: { clinicId } });
  let n = count + 1;
  // Guard against gaps from deletions colliding with an existing code.
  for (;;) {
    const code = `EGAN-P-${String(n).padStart(4, '0')}`;
    const exists = await prisma.patient.findUnique({ where: { patientCode: code }, select: { id: true } });
    if (!exists) return code;
    n += 1;
  }
}

export async function nextPrescriptionNo(clinicId: string): Promise<string> {
  const count = await prisma.prescription.count({ where: { clinicId } });
  let n = count + 1;
  for (;;) {
    const no = `EGAN-RX-${String(n).padStart(5, '0')}`;
    const exists = await prisma.prescription.findUnique({ where: { prescriptionNo: no }, select: { id: true } });
    if (!exists) return no;
    n += 1;
  }
}

export async function nextInvoiceNo(clinicId: string): Promise<string> {
  const count = await prisma.invoice.count({ where: { clinicId } });
  let n = count + 1;
  for (;;) {
    const no = `EGAN-INV-${String(n).padStart(5, '0')}`;
    const exists = await prisma.invoice.findUnique({ where: { invoiceNo: no }, select: { id: true } });
    if (!exists) return no;
    n += 1;
  }
}
