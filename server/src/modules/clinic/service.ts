import { prisma } from '../../shared/prisma.js';
import { CLINIC_SETTING_KEYS } from '../../shared/constants.js';

/**
 * Clinic settings are stored as key/value rows so new options can be added
 * without a schema migration. This helper returns typed accessors.
 */
export async function getClinicSettings(clinicId: string): Promise<Record<string, string>> {
  const rows = await prisma.clinicSetting.findMany({ where: { clinicId } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value ?? '']));
}

export async function setClinicSetting(clinicId: string, key: string, value: string | null): Promise<void> {
  await prisma.clinicSetting.upsert({
    where: { clinicId_key: { clinicId, key } },
    create: { clinicId, key, value },
    update: { value },
  });
}

export async function isMedicalShopEnabled(clinicId: string): Promise<boolean> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { medicalShopEnabled: true },
  });
  if (clinic?.medicalShopEnabled) return true;
  const settings = await getClinicSettings(clinicId);
  return settings[CLINIC_SETTING_KEYS.MEDICAL_SHOP_ENABLED] === 'true';
}

export function parseCustomVitals(settings: Record<string, string>) {
  const raw = settings[CLINIC_SETTING_KEYS.CUSTOM_VITALS];
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Array<{ key: string; label: string; unit?: string }>;
  } catch {
    return [];
  }
}
