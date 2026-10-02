import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BellRing, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Field';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { FollowUp } from '@/types';

export function FollowUpsPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const clinicId = activeClinic?.id;
  const [status, setStatus] = useState('PENDING');

  const { data, isLoading } = useQuery({
    queryKey: ['follow-ups', clinicId, status],
    queryFn: () => api.get<{ followUps: FollowUp[] }>('/follow-ups', { clinicId, status }),
    enabled: Boolean(clinicId),
  });

  const markDone = useMutation({
    mutationFn: (id: string) => api.patch(`/follow-ups/${id}/status`, { status: 'DONE' }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['follow-ups'] }); toast.success('Follow-up marked done'); },
    onError: (e) => toast.error('Could not update', e instanceof ApiError ? e.message : undefined),
  });

  const sendReminders = useMutation({
    mutationFn: () => api.post<{ sent: number }>('/follow-ups/send-reminders', { clinicId }),
    onSuccess: (res) => toast.success('Reminders sent', `${res.sent} patient(s) notified.`),
    onError: (e) => toast.error('Could not send reminders', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        subtitle="Scheduled reviews and reminders"
        actions={
          <>
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
              <option value="">All</option>
              {['PENDING', 'DONE', 'MISSED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            {can(PERMISSIONS.NOTIFICATION_MANAGE) && (
              <Button variant="secondary" onClick={() => sendReminders.mutate()} loading={sendReminders.isPending}>
                <BellRing className="h-4 w-4" /> Send due reminders
              </Button>
            )}
          </>
        }
      />

      {isLoading ? <InlineSpinner /> : !data?.followUps.length ? (
        <EmptyState icon={<Activity className="h-5 w-5" />} title="No follow-ups" message="Follow-ups are scheduled during a consultation." />
      ) : (
        <ul className="space-y-2">
          {data.followUps.map((f) => (
            <li key={f.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <Link to={`/patients/${f.patientId}`} className="text-sm font-semibold text-ink-900 hover:text-brand-700">{f.patient?.name}</Link>
                <p className="hint">{f.patient?.patientCode} · Dr. {f.doctor?.name} · due {formatDate(f.dueDate)}</p>
                {f.instructions && <p className="mt-0.5 text-sm text-ink-600">{f.instructions}</p>}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={f.status} />
                {can(PERMISSIONS.CONSULTATION_MANAGE) && f.status === 'PENDING' && (
                  <Button size="sm" variant="success" onClick={() => markDone.mutate(f.id)}><CheckCircle2 className="h-3.5 w-3.5" /> Done</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
