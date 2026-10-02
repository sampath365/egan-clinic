import { useQuery } from '@tanstack/react-query';
import { ListOrdered } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { QueueToken } from '@/types';

interface PositionResult {
  tokenNumber: number;
  status: string;
  currentTokenNumber: number | null;
  approximatePosition: number;
  isEstimate: boolean;
}

export function PatientQueuePage() {
  const { data: me, isLoading: loadingMe } = useMyPatient();

  const { data, isLoading } = useQuery({
    queryKey: ['my-queue', me?.id],
    queryFn: () => api.get<{ tokens: QueueToken[] }>('/queue'),
    enabled: Boolean(me?.id),
    refetchInterval: 20_000,
  });

  const tokens = data?.tokens ?? [];
  const active = tokens.find((t) => ['WAITING', 'CONSULTING', 'RECALLED'].includes(t.status)) ?? tokens[0];

  const { data: position } = useQuery({
    queryKey: ['my-queue-position', active?.id],
    queryFn: () => api.get<PositionResult>(`/queue/${active!.id}/position`),
    enabled: Boolean(active?.id),
    refetchInterval: 20_000,
  });

  if (loadingMe || isLoading) return <InlineSpinner />;

  return (
    <div>
      <PageHeader title="My token" subtitle="Your position in today's clinic queue" />

      {!active ? (
        <EmptyState icon={<ListOrdered className="h-5 w-5" />} title="You have no token today" message="A token is issued when you check in at reception." />
      ) : (
        <div className="mx-auto max-w-md">
          <div className="card card-pad text-center">
            <p className="section-title">Your token</p>
            <p className="mt-2 text-6xl font-bold text-brand-700">{String(active.tokenNumber).padStart(2, '0')}</p>
            <div className="mt-3 flex justify-center"><StatusBadge status={active.status} /></div>

            <dl className="mt-5 space-y-2 text-left text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Doctor</dt>
                <dd className="font-medium text-ink-900">{active.doctor?.name ?? '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Now serving</dt>
                <dd className="font-medium text-ink-900">
                  {position?.currentTokenNumber != null ? String(position.currentTokenNumber).padStart(2, '0') : '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink-500">Ahead of you</dt>
                <dd className="font-medium text-ink-900">
                  {position ? Math.max(0, position.approximatePosition - 1) : '—'}
                </dd>
              </div>
              {active.calledAt && (
                <div className="flex items-center justify-between">
                  <dt className="text-ink-500">Called at</dt>
                  <dd className="text-ink-700">{formatTime(active.calledAt)}</dd>
                </div>
              )}
            </dl>

            <p className="hint mt-4">
              Position is an estimate based on the live queue, not a guaranteed waiting time.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
