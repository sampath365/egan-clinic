import { Search as SearchIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function Search({ value, onChange, placeholder = 'Search…', className, autoFocus }: SearchProps) {
  return (
    <div className={cn('relative', className)}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-lg border border-ink-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}
