import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ListOrdered, Megaphone, RotateCcw, SkipForward, Stethoscope, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatTime, humanize } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { QueueToken } from '@/types';

const ACTION_PERMISSION = PERMISSIONS.QUEUE_MANAGE;

export function QueuePage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const clinicId = activeClinic?.id;

  const { data, isLoading } = useQuery({
    queryKey: ['queue', clinicId],
    queryFn: () => api.get<{ date: string; tokens: QueueToken[] }>('/queue', { clinicId }),
    enabled: Boolean(clinicId),
    refetchInterval: 15_000,
  });

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.post(`/queue/${id}/${action}`),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      toast.success(`Token ${v.action}${v.action.endsWith('e') ? 'd' : 'ed'}`.replace('calld', 'called').replace('skiped', 'skipped').replace('recalled', 'recalled').replace('completed', 'completed').replace('cancelled', 'cancelled'));
    },
    onError: (e) => toast.error('Could not update token', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading) return <InlineSpinner label="Loading queue…" />;

  const tokens = data?.tokens ?? [];
  const byDoctor = new Map<string, QueueToken[]>();
  for (const t of tokens) {
    const key = t.doctor?.name ?? 'Unassigned';
    if (!byDoctor.has(key)) byDoctor.set(key, []);
    byDoctor.get(key)!.push(t);
  }

  return (
    <div>
      <PageHeader
        title="Today's queue"
        subtitle={`Token queue for ${new Date(data?.date ?? Date.now()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`}
        actions={
          <Button variant="secondary" onClick={() => void qc.invalidateQueries({ queryKey: ['queue'] })}>
            <RotateCcw className="h-4 w-4" /> Refresh
          </Button>
        }
      />

      {tokens.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="h-5 w-5" />}
          title="The queue is empty"
          message="Issue a token from the Appointments page or when a walk-in patient arrives."
        />
      ) : (
        <div className="space-y-6">
          {[...byDoctor.entries()].map(([doctorName, list]) => {
            const current = list.find((t) => t.status === 'CONSULTING');
            return (
              <section key={doctorName}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="section-title">{doctorName}</h2>
                  {current ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                      <Stethoscope className="h-3.5 w-3.5" /> Now consulting · Token {String(current.tokenNumber).padStart(2, '0')}
                    </span>
                  ) : (
                    <span className="hint">No one is being consulted right now</span>
                  )}
                </div>

                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {list.map((t) => (
                    <li key={t.id} className="card flex items-center gap-3 p-3">
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold ${t.status === 'CONSULTING' ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-700'}`}>
                        {String(t.tokenNumber).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-900">{t.patient?.name}</p>
                        <p className="hint truncate">
                          {t.patient?.patientCode}
                          {t.calledAt ? ` · called ${formatTime(t.calledAt)}` : ''}
                        </p>
                        <div className="mt-1"><StatusBadge status={t.status} /></div>
                      </div>

                      {can(ACTION_PERMISSION) && (
                        <div className="flex flex-col items-end gap-1">
                          {['WAITING', 'RECALLED', 'SKIPPED'].includes(t.status) && (
                            <Button size="sm" onClick={() => act.mutate({ id: t.id, action: 'call' })}>
                              <Megaphone className="h-3.5 w-3.5" /> Call
                            </Button>
                          )}
                          {t.status === 'CONSULTING' && (
                            <Button size="sm" variant="success" onClick={() => act.mutate({ id: t.id, action: 'complete' })}>
                              <CheckCircle2 className="h-3.5 w-3.5" /> Done
                            </Button>
                          )}
                          {t.status === 'WAITING' && (
                            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'skip' })}>
                              <SkipForward className="h-3.5 w-3.5" /> Skip
                            </Button>
                          )}
                          {t.status === 'SKIPPED' && (
                            <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: t.id, action: 'recall' })}>
                              <RotateCcw className="h-3.5 w-3.5" /> Recall
                            </Button>
                          )}
                          {['WAITING', 'SKIPPED', 'RECALLED'].includes(t.status) && (
                            <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: t.id, action: 'cancel' })} title="Cancel token">
                              <XCircle className="h-3.5 w-3.5 text-ink-400" />
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="hint mt-2">
                  Waiting: {list.filter((t) => t.status === 'WAITING').length} · {humanize('WAITING')} position is an estimate based on live clinic data.
                </p>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
