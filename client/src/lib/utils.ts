import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDate(d)} · ${formatTime(d)}`;
}

export function formatCurrency(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function ageFromDob(dob?: string | null): string {
  if (!dob) return '—';
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return '—';
  const years = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${years} yrs`;
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function humanize(value?: string | null): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Maps a status string to a semantic tone used by StatusBadge. */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export function statusTone(status?: string | null): Tone {
  switch ((status ?? '').toUpperCase()) {
    case 'COMPLETED': case 'PAID': case 'ACCEPTED': case 'READY': case 'DONE':
    case 'ISSUED': case 'SUCCESS': case 'CONFIRMED': case 'DELIVERED': case 'PICKED_UP':
      return 'success';
    case 'WAITING': case 'BOOKED': case 'DRAFT': case 'PENDING': case 'UNPAID':
    case 'RECEIVED': case 'ORDERED':
      return 'info';
    case 'IN_PROGRESS': case 'IN_CONSULTATION': case 'CONSULTING': case 'REVIEW':
    case 'UNDER_REVIEW': case 'PROCESSING': case 'PARTIALLY_PAID': case 'CLARIFICATION_REQUIRED':
    case 'RECALLED': case 'SHARED':
      return 'warning';
    case 'CANCELLED': case 'REJECTED': case 'NO_SHOW': case 'FAILED': case 'MISSED':
    case 'REFUNDED': case 'CORRECTED':
      return 'danger';
    case 'VIEWED': case 'CHECKED_IN':
      return 'brand';
    default:
      return 'neutral';
  }
}
