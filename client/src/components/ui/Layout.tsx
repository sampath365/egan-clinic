import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('card card-pad', className)}>{children}</div>;
}

export function StatCard({
  label, value, hint, icon, tone = 'brand', onClick,
}: {
  label: string; value: ReactNode; hint?: string; icon?: ReactNode;
  tone?: 'brand' | 'info' | 'warning' | 'success' | 'danger'; onClick?: () => void;
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-700',
    info: 'bg-sky-50 text-sky-700',
    warning: 'bg-amber-50 text-amber-700',
    success: 'bg-emerald-50 text-emerald-700',
    danger: 'bg-red-50 text-red-700',
  };
  return (
    <div
      onClick={onClick}
      className={cn('card card-pad flex items-center gap-4', onClick && 'cursor-pointer transition-shadow hover:shadow-pop')}
    >
      {icon && <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', tones[tone])}>{icon}</div>}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
        <p className="mt-0.5 text-2xl font-semibold text-ink-900">{value}</p>
        {hint && <p className="hint truncate">{hint}</p>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, message, action }: { icon?: ReactNode; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="card card-pad flex flex-col items-center justify-center py-10 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-500">{icon}</div>}
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      {message && <p className="mt-1 max-w-sm text-sm text-ink-500">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-ink-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Avatar({ name, src, size = 40 }: { name?: string | null; src?: string | null; size?: number }) {
  const text = (name ?? '?').replace(/^Dr\.?\s+/i, '').split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  if (src) return <img src={src} alt={name ?? ''} width={size} height={size} className="rounded-full object-cover" />;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {text || '?'}
    </span>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: Array<{ key: string; label: ReactNode; disabled?: boolean }>; value: string; onChange: (key: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-lg bg-ink-100 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={value === t.key}
          disabled={t.disabled}
          onClick={() => onChange(t.key)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40',
            value === t.key ? 'bg-white text-brand-700 shadow-card' : 'text-ink-600 hover:text-ink-900',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
