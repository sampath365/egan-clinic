import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Consultation } from '@/types';

export function ConsultationsPage() {
  const { activeClinic } = useAuth();
  const clinicId = activeClinic?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['consultations', clinicId],
    queryFn: () => api.get<{ consultations: Consultation[] }>('/consultations', { clinicId }),
    enabled: Boolean(clinicId),
  });

  const columns: Column<Consultation>[] = [
    { key: 'when', header: 'When', render: (c) => <span className="font-medium text-ink-900">{formatDateTime(c.startedAt)}</span> },
    {
      key: 'patient', header: 'Patient',
      render: (c) => (
        <div>
          <p className="font-medium text-ink-900">{c.patient?.name}</p>
          <p className="hint">{c.patient?.patientCode}</p>
        </div>
      ),
    },
    { key: 'doctor', header: 'Doctor', render: (c) => <span>{c.doctor?.name}</span> },
    { key: 'diagnosis', header: 'Diagnosis', render: (c) => <span className="text-ink-600">{c.diagnosis ?? c.chiefComplaint ?? '—'}</span> },
    { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'open', header: '', align: 'right',
      render: (c) => <Link to={`/consultations/${c.id}`} className="text-sm font-medium text-brand-700 hover:underline">Open</Link>,
    },
  ];

  return (
    <div>
      <PageHeader title="Consultations" subtitle="Active and completed visits" />
      <DataTable
        columns={columns}
        rows={data?.consultations ?? []}
        rowKey={(c) => c.id}
        loading={isLoading}
        empty={<EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No consultations yet" message="Start one from a patient record or from the queue." />}
      />
    </div>
  );
}
