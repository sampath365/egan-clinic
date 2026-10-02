import { cn, humanize, statusTone, type Tone } from '@/lib/utils';

const tones: Record<Tone, string> = {
  neutral: 'bg-ink-100 text-ink-700 ring-ink-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
};

export function StatusBadge({ status, tone, label, className }: { status?: string | null; tone?: Tone; label?: string; className?: string }) {
  const t = tone ?? statusTone(status);
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', tones[t], className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', t === 'success' ? 'bg-emerald-500' : t === 'danger' ? 'bg-red-500' : t === 'warning' ? 'bg-amber-500' : t === 'info' ? 'bg-sky-500' : t === 'brand' ? 'bg-brand-500' : 'bg-ink-400')} />
      {label ?? humanize(status)}
    </span>
  );
}
