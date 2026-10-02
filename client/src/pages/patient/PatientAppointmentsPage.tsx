import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { Appointment } from '@/types';

export function PatientAppointmentsPage() {
  const { data: me, isLoading: loadingMe } = useMyPatient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-appointments', me?.id],
    queryFn: () => api.get<{ items: Appointment[] }>('/appointments', { patientId: me!.id }),
    enabled: Boolean(me?.id),
  });

  if (loadingMe || isLoading) return <InlineSpinner />;

  const items = data?.items ?? [];
  const upcoming = items.filter((a) => new Date(a.scheduledAt) >= new Date());
  const past = items.filter((a) => new Date(a.scheduledAt) < new Date());

  return (
    <div>
      <PageHeader title="My appointments" subtitle="Upcoming and past visits" />
      {items.length === 0 ? (
        <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No appointments" message="Your appointments will appear here." />
      ) : (
        <div className="space-y-6">
          <Section title="Upcoming" items={upcoming} />
          <Section title="Past" items={past} />
        </div>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: Appointment[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h2 className="section-title mb-2">{title}</h2>
      <ul className="card divide-y divide-ink-100">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink-900">{a.doctor?.name}</p>
              <p className="hint">{formatDateTime(a.scheduledAt)}{a.reason ? ` · ${a.reason}` : ''}</p>
            </div>
            <StatusBadge status={a.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
