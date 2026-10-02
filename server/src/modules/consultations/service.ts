/** Body-mass index, rounded to one decimal. Returns null when inputs are absent. */
export function computeBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const heightM = heightCm / 100;
  if (heightM <= 0) return null;
  return Math.round((weightKg / (heightM * heightM)) * 10) / 10;
}
