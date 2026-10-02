import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export function ForbiddenPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="card card-pad max-w-md text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold text-ink-900">Access denied</h1>
        <p className="mt-1 text-sm text-ink-500">
          Your role does not include permission for this area. If you believe this is an error, contact your clinic owner.
        </p>
        <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Return to dashboard</Link>
      </div>
    </div>
  );
}
