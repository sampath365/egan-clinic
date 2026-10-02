import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ForbiddenPage } from '@/pages/ForbiddenPage';

/**
 * Client-side gate. This is a UX convenience only — the server enforces the
 * same permission on every request, so bypassing this cannot grant access.
 */
export function PermissionGate({
  permission, anyRole, children,
}: { permission?: string; anyRole?: string[]; children: ReactNode }) {
  const { can, hasRole, loading } = useAuth();
  if (loading) return null;
  if (permission && !can(permission)) return <ForbiddenPage />;
  if (anyRole && !hasRole(...anyRole)) return <ForbiddenPage />;
  return <>{children}</>;
}
