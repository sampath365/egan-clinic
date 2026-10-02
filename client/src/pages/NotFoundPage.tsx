import { LinkButton } from '@/components/ui/Button';
import { FileQuestion } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card card-pad max-w-md text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-500">
          <FileQuestion className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-ink-900">Page not found</h1>
        <p className="mt-1 text-sm text-ink-500">The page you are looking for does not exist or has been moved.</p>
        <LinkButton to="/" tone="brand" className="mt-4">Return to dashboard</LinkButton>
      </div>
    </div>
  );
}
