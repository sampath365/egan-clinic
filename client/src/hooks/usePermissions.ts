import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

/** Convenience wrapper for permission checks in components. */
export function usePermissions() {
  const { can, hasRole, user } = useAuth();
  return useMemo(() => ({ can, hasRole, roles: user?.roles ?? [], permissions: user?.permissions ?? [] }), [can, hasRole, user]);
}

/** Clinic-scoped query key helper so cache entries are scoped per clinic. */
export function clinicKey(scope: string, clinicId?: string | null, extra?: unknown) {
  return [scope, clinicId ?? 'none', extra ?? null] as const;
}
