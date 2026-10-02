
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardList, Download, Share2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { useMyPatient } from './PatientHomePage';
import type { Prescription } from '@/types';

export function PatientPrescriptionsPage() {
  const toast = useToast();
  const { data: me, isLoading: loadingMe } = useMyPatient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-prescriptions', me?.id],
    queryFn: () => api.get<{ items: Prescription[] }>('/prescriptions', { patientId: me!.id }),
    enabled: Boolean(me?.id),
  });

  const share = useMutation({
    mutationFn: (id: string) => api.post<{ fallbackUrl: string; providerConfigured: boolean }>(`/prescriptions/${id}/whatsapp`),
    onSuccess: (res) => {
      if (!res.providerConfigured) window.open(res.fallbackUrl, '_blank', 'noopener');
      toast.info('Sharing', 'A secure link is shared rather than clinical details.');
    },
    onError: (e) => toast.error('Could not share', e instanceof ApiError ? e.message : undefined),
  });

  async function download(id: string, no: string) {
    const blob = await api.blob(`/prescriptions/${id}/pdf`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${no}.pdf`; a.click(); URL.revokeObjectURL(url);
  }

  if (loadingMe || isLoading) return <InlineSpinner />;
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="My prescriptions" subtitle="Issued prescriptions from your clinic visits" />
      {items.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No prescriptions yet" message="Prescriptions issued to you will appear here." />
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="card card-pad">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link to={`/prescriptions/${p.id}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{p.prescriptionNo}</Link>
                  <p className="hint">Dr. {p.doctor?.name} · {formatDateTime(p.issuedAt ?? p.createdAt)}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={`/prescriptions/${p.id}`} className="inline-flex h-9 items-center rounded-lg border border-ink-300 px-3 text-sm font-medium hover:bg-ink-50">View</Link>
                <Button size="sm" variant="secondary" onClick={() => void download(p.id, p.prescriptionNo)}><Download className="h-3.5 w-3.5" /> Download</Button>
                <Button size="sm" variant="secondary" onClick={() => share.mutate(p.id)} loading={share.isPending}><Share2 className="h-3.5 w-3.5" /> Share</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
