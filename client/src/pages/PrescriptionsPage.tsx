import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Select } from '@/components/ui/Field';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Paginated, Prescription } from '@/types';

export function PrescriptionsPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const clinicId = activeClinic?.id;
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['prescriptions', clinicId, status],
    queryFn: () => api.get<Paginated<Prescription>>('/prescriptions', { clinicId, status, pageSize: 50 }),
    enabled: Boolean(clinicId),
  });

  const columns: Column<Prescription>[] = [
    { key: 'no', header: 'Prescription', render: (p) => <span className="font-medium text-ink-900">{p.prescriptionNo}</span> },
    {
      key: 'patient', header: 'Patient',
      render: (p) => (<div><p className="font-medium text-ink-900">{p.patient?.name}</p><p className="hint">{p.patient?.patientCode}</p></div>),
    },
    { key: 'doctor', header: 'Doctor', render: (p) => <span>{p.doctor?.name}</span> },
    { key: 'version', header: 'Version', render: (p) => <span>v{p.versions[0]?.version ?? 1}</span> },
    { key: 'date', header: 'Date', render: (p) => <span className="hint">{formatDateTime(p.issuedAt ?? p.createdAt)}</span> },
    { key: 'status', header: 'Status', render: (p) => <StatusBadge status={p.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (p) => (
        <div className="flex justify-end gap-2">
          {can(PERMISSIONS.PRESCRIPTION_CREATE) && (p.status === 'DRAFT' || p.status === 'REVIEW') && (
            <Link to={`/prescriptions/${p.id}/edit`} className="text-sm font-medium text-brand-700 hover:underline">Edit</Link>
          )}
          <Link to={`/prescriptions/${p.id}`} className="text-sm font-medium text-ink-700 hover:underline">View</Link>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Prescriptions"
        subtitle="Draft, issued and shared prescriptions"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {['DRAFT', 'REVIEW', 'ISSUED', 'SHARED', 'VIEWED', 'CORRECTED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        }
      />
      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(p) => p.id}
        loading={isLoading}
        onRowClick={(p) => navigate(`/prescriptions/${p.id}`)}
        empty={<EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No prescriptions" message="Prescriptions are created during a consultation." />}
      />
    </div>
  );
}
