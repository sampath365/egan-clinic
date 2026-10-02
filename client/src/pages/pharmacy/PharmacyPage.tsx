import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Pill, Settings } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState, StatCard } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { PharmacyPrescription } from '@/types';
import { LinkButton } from '@/components/ui/Button';

export function PharmacyPage() {
  const { activeClinic, hasRole } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const clinicId = activeClinic?.id;
  const isPharmacist = hasRole('PHARMACIST');

  // Pharmacists see the prescriptions shared with their pharmacy; owners see the
  // clinic-side medical shop overview.
  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-prescriptions', isPharmacist],
    queryFn: () => api.get<{ items: PharmacyPrescription[] }>('/pharmacy-prescriptions'),
    enabled: isPharmacist,
  });

  const { data: clinicView } = useQuery({
    queryKey: ['pharmacy-clinic-view', clinicId],
    queryFn: () => api.get<{ enabled: boolean; items: PharmacyPrescription[] }>('/reports/pharmacy-prescriptions', { clinicId }),
    enabled: !isPharmacist && Boolean(clinicId) && can(PERMISSIONS.PHARMACY_VIEW),
  });

  if (!activeClinic?.medicalShopEnabled && !isPharmacist) {
    return (
      <div>
        <PageHeader title="Medical shop" subtitle="Pharmacy workflow" />
        <EmptyState
          icon={<Settings className="h-5 w-5" />}
          title="The medical shop module is disabled"
          message="Enable it in Settings to attach a medical shop and send prescriptions to a pharmacy."
          action={<LinkButton to="/settings" tone="brand">Open settings</LinkButton>}
        />
      </div>
    );
  }

  const items = isPharmacist ? (data?.items ?? []) : (clinicView?.items ?? []);
  const pending = items.filter((i) => ['RECEIVED', 'UNDER_REVIEW'].includes(i.status)).length;
  const ready = items.filter((i) => i.status === 'READY').length;
  const completed = items.filter((i) => i.status === 'COMPLETED').length;

  const columns: Column<PharmacyPrescription>[] = [
    { key: 'no', header: 'Prescription', render: (i) => <span className="font-medium text-ink-900">{i.prescription?.prescriptionNo}</span> },
    {
      key: 'patient', header: 'Patient',
      render: (i) => (<div><p className="font-medium text-ink-900">{i.prescription?.patient?.name}</p><p className="hint">{i.prescription?.patient?.patientCode}</p></div>),
    },
    { key: 'doctor', header: 'Doctor', render: (i) => <span>{i.prescription?.doctor?.name}</span> },
    { key: 'received', header: 'Received', render: (i) => <span className="hint">{formatDateTime(i.receivedAt)}</span> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    { key: 'open', header: '', align: 'right', render: () => <span className="text-sm font-medium text-brand-700">Review</span> },
  ];

  return (
    <div>
      <PageHeader
        title={isPharmacist ? 'Prescription inbox' : 'Medical shop'}
        subtitle={isPharmacist ? 'Prescriptions shared with your pharmacy' : 'Prescriptions forwarded to the attached medical shop'}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting review" value={pending} tone="warning" icon={<Pill className="h-5 w-5" />} />
        <StatCard label="Ready for pickup" value={ready} tone="success" icon={<Pill className="h-5 w-5" />} />
        <StatCard label="Completed" value={completed} tone="brand" icon={<Pill className="h-5 w-5" />} />
      </div>

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(i) => i.id}
        loading={isLoading}
        onRowClick={(i) => navigate(`/pharmacy/${i.id}`)}
        empty={<EmptyState icon={<Pill className="h-5 w-5" />} title="No prescriptions" message="Shared prescriptions will appear here for pharmacist review." />}
      />

      <p className="hint mt-3">
        Every prescription must be independently reviewed by a pharmacist before dispensing. Medicines are never dispensed automatically.
      </p>
    </div>
  );
}
