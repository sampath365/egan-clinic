import { useRef, useState, type ReactNode } from 'react';
import { FileUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './Button';

interface FileUploaderProps {
  onUpload: (file: File, meta: { title: string; category: string }) => Promise<void>;
  categories?: Array<{ value: string; label: string }>;
  defaultTitle?: string;
  accept?: string;
  className?: string;
  children?: ReactNode;
}

const DEFAULT_CATEGORIES = [
  { value: 'LAB_REPORT', label: 'Lab report' },
  { value: 'SCAN', label: 'Scan / imaging' },
  { value: 'PRESCRIPTION', label: 'Previous prescription' },
  { value: 'DISCHARGE', label: 'Discharge summary' },
  { value: 'CERTIFICATE', label: 'Medical certificate' },
  { value: 'REFERRAL', label: 'Referral document' },
  { value: 'OTHER', label: 'Other' },
];

export function FileUploader({ onUpload, categories = DEFAULT_CATEGORIES, defaultTitle = '', accept = 'application/pdf,image/*', className, children }: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [category, setCategory] = useState(categories[0]?.value ?? 'OTHER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await onUpload(file, { title: title || file.name, category });
      setTitle('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('space-y-3', className)}>
      {children}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Document title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. CBC report — Oct 2026"
            className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="label">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-ink-300 bg-ink-50/60 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40',
          busy && 'pointer-events-none opacity-60',
        )}
      >
        <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={(e) => void handleFiles(e.target.files)} />
        {busy ? <Loader2 className="h-6 w-6 animate-spin text-brand-600" /> : <FileUp className="h-6 w-6 text-ink-400" />}
        <span className="text-sm font-medium text-ink-700">{busy ? 'Uploading…' : 'Choose a file or drag it here'}</span>
        <span className="hint">PDF or image, up to 25 MB</span>
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export { Button as UploaderButton };
