import { useQuery } from '@tanstack/react-query';
import { Stethoscope } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { Consultation } from '@/types';

export function PatientVisitsPage() {
  const { data: me, isLoading: loadingMe } = useMyPatient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-consultations', me?.id],
    queryFn: () => api.get<{ consultations: Consultation[] }>('/consultations', { patientId: me!.id }),
    enabled: Boolean(me?.id),
  });

  if (loadingMe || isLoading) return <InlineSpinner />;
  const items = data?.consultations ?? [];

  return (
    <div>
      <PageHeader title="My visits" subtitle="A summary of your consultations" />
      {items.length === 0 ? (
        <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No visits recorded" />
      ) : (
        <ul className="space-y-2">
          {items.map((c) => (
            <li key={c.id} className="card card-pad">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{formatDateTime(c.startedAt)}</p>
                  <p className="hint">{c.doctor?.name}{c.doctor?.specialization ? ` · ${c.doctor.specialization}` : ''}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                {c.chiefComplaint && <Field label="Chief complaint" value={c.chiefComplaint} />}
                {c.diagnosis && <Field label="Diagnosis" value={c.diagnosis} />}
                {c.advice && <Field label="Advice" value={c.advice} />}
                {c.followUpDate && <Field label="Follow-up" value={formatDateTime(c.followUpDate)} />}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-ink-800">{value}</dd>
    </div>
  );
}
