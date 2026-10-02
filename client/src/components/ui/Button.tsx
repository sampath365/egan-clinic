import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary: 'bg-ink-100 text-ink-800 hover:bg-ink-200 active:bg-ink-300 disabled:text-ink-400',
  ghost: 'bg-transparent text-ink-700 hover:bg-ink-100 active:bg-ink-200',
  outline: 'border border-ink-300 bg-white text-ink-800 hover:bg-ink-50',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:bg-red-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-emerald-300',
};

// Inline text links need a touch target, but must not grow the line height.
// `py-2 -my-2` expands the hit area vertically while staying visually inline.
const linkVariants: Record<'brand' | 'muted', string> = {
  brand: 'text-brand-700 hover:underline',
  muted: 'text-ink-700 hover:underline',
};

const sizes: Record<Size, string> = {
  // Touch-friendly minimums: nothing below 36px tall, primary actions 44px+.
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
  icon: 'h-11 w-11 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
});

export interface LinkButtonProps {
  to: string;
  children: ReactNode;
  /** `brand` for primary links, `muted` for secondary ones. */
  tone?: 'brand' | 'muted';
  className?: string;
  title?: string;
  'aria-label'?: string;
}

/**
 * An inline text link with a comfortable touch target. Keeps the visual size of
 * a text link while expanding the tappable area to ~36px on small screens.
 */
export function LinkButton({ to, children, tone = 'brand', className, ...rest }: LinkButtonProps) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center py-2.5 -my-2.5 text-sm font-medium sm:py-0 sm:my-0',
        linkVariants[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}
