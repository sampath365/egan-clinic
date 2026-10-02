import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { Search } from '@/components/ui/Search';
import { Select } from '@/components/ui/Field';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { AuditEntry, Paginated } from '@/types';

const ACTIONS = [
  'PATIENT_CREATED', 'PATIENT_UPDATED', 'CONSULTATION_CREATED', 'PRESCRIPTION_CREATED', 'PRESCRIPTION_ISSUED',
  'PRESCRIPTION_CORRECTED', 'PRESCRIPTION_VIEWED', 'PRESCRIPTION_SHARED', 'PHARMACY_ACCESSED_PRESCRIPTION',
  'PAYMENT_CREATED', 'PAYMENT_REFUNDED', 'USER_PERMISSION_CHANGED', 'MEDICAL_SHOP_TOGGLED', 'CONSENT_GRANTED',
];

export function AuditPage() {
  const { activeClinic } = useAuth();
  const clinicId = activeClinic?.id;
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', clinicId, action],
    queryFn: () => api.get<Paginated<AuditEntry>>('/audit', { clinicId, action, pageSize: 100 }),
    enabled: Boolean(clinicId),
  });

  const items = (data?.items ?? []).filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return e.action.toLowerCase().includes(q) || (e.actorName ?? '').toLowerCase().includes(q) || e.entityType.toLowerCase().includes(q);
  });

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Sensitive actions recorded across the clinic"
        actions={
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-52">
            <option value="">All actions</option>
            {ACTIONS.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
          </Select>
        }
      />

      <div className="mb-4 max-w-md"><Search value={search} onChange={setSearch} placeholder="Filter by action, user or entity" /></div>

      {isLoading ? <InlineSpinner /> : items.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No audit entries" message="Sensitive actions will appear here as they occur." />
      ) : (
        <ol className="relative space-y-4 border-l border-ink-200 pl-5">
          {items.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
              <div className="card card-pad">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{humanize(e.action)}</p>
                  <p className="hint">{formatDateTime(e.createdAt)}</p>
                </div>
                <p className="hint mt-1">
                  {e.actorName ?? 'System'} · {e.entityType}{e.entityId ? ` · ${e.entityId.slice(0, 10)}…` : ''}
                  {e.ipAddress ? ` · ${e.ipAddress}` : ''}
                </p>
                {e.metadataJson && <pre className="scroll-thin mt-2 overflow-x-auto rounded-lg bg-ink-50 p-2 text-[11px] text-ink-600">{e.metadataJson}</pre>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
