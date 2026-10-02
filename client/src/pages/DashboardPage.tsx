import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, ListOrdered, IndianRupee, Activity, Pill, Users, ArrowRight, Stethoscope } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { PageHeader, StatCard, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { DashboardData, QueueToken } from '@/types';

export function DashboardPage() {
  const { user, activeClinic } = useAuth();
  const navigate = useNavigate();
  const clinicId = activeClinic?.id;

  // Patient-only users get the patient portal instead of the clinic dashboard.
  const patientOnly = (user?.scopes.patientIds.length ?? 0) > 0 && (user?.scopes.clinicIds.length ?? 0) === 0;
  if (patientOnly) {
    return <PatientRedirect />;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', clinicId],
    queryFn: () => api.get<DashboardData>('/reports/dashboard', { clinicId }),
    enabled: Boolean(clinicId),
  });

  const { data: queue } = useQuery({
    queryKey: ['queue', clinicId],
    queryFn: () => api.get<{ tokens: QueueToken[] }>('/queue', { clinicId }),
    enabled: Boolean(clinicId),
  });

  const waiting = queue?.tokens.filter((t) => t.status === 'WAITING').slice(0, 6) ?? [];

  if (isLoading || !data) return <InlineSpinner label="Loading dashboard…" />;

  return (
    <div>
      <PageHeader
        title={`Good day, ${user?.fullName.split(' ').slice(0, 2).join(' ')}`}
        subtitle={activeClinic ? `${activeClinic.name} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}` : undefined}
        actions={
          <>
            <Link to="/appointments" className="inline-flex h-10 items-center gap-2 rounded-lg border border-ink-300 bg-white px-4 text-sm font-medium hover:bg-ink-50">
              <CalendarDays className="h-4 w-4" /> Appointments
            </Link>
            <Link to="/queue" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
              <ListOrdered className="h-4 w-4" /> Queue
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Today's appointments" value={data.today.appointments} icon={<CalendarDays className="h-5 w-5" />} onClick={() => navigate('/appointments')} />
        <StatCard label="Waiting" value={data.today.waiting} tone="info" icon={<ListOrdered className="h-5 w-5" />} onClick={() => navigate('/queue')} />
        <StatCard label="Completed" value={data.today.completed} tone="success" icon={<Stethoscope className="h-5 w-5" />} />
        <StatCard label="Follow-ups" value={data.today.followUps} tone="warning" icon={<Activity className="h-5 w-5" />} onClick={() => navigate('/follow-ups')} />
        <StatCard label="Today's revenue" value={formatCurrency(data.today.revenue, activeClinic?.currency)} tone="success" icon={<IndianRupee className="h-5 w-5" />} onClick={() => navigate('/billing')} />
      </div>

      {data.medicalShop && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Medical shop requests"
            value={data.medicalShop.newPrescriptionRequests}
            tone="brand"
            hint="New prescriptions awaiting pharmacy review"
            icon={<Pill className="h-5 w-5" />}
            onClick={() => navigate('/pharmacy')}
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Waiting queue */}
        <section className="lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Now waiting</h2>
            <Link to="/queue" className="text-xs font-medium text-brand-700 hover:underline">View queue</Link>
          </div>
          {waiting.length === 0 ? (
            <EmptyState icon={<ListOrdered className="h-5 w-5" />} title="No one is waiting" message="New tokens will appear here as patients check in." />
          ) : (
            <ul className="card divide-y divide-ink-100">
              {waiting.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-sm font-semibold text-brand-700">
                    {String(t.tokenNumber).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{t.patient?.name}</p>
                    <p className="hint truncate">{t.doctor?.name}</p>
                  </div>
                  <StatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent prescriptions */}
        <section className="lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="section-title">Recent prescriptions</h2>
            <Link to="/prescriptions" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>
          </div>
          {data.recentPrescriptions.length === 0 ? (
            <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No prescriptions yet" />
          ) : (
            <ul className="card divide-y divide-ink-100">
              {data.recentPrescriptions.map((p) => (
                <li key={p.id}>
                  <Link to={`/prescriptions/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{p.patient.name}</p>
                      <p className="hint truncate">{p.prescriptionNo} · {p.doctor.name}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent patients + pending payments */}
        <section className="space-y-4 lg:col-span-1">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="section-title">Recent patients</h2>
              <Link to="/patients" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>
            </div>
            {data.recentPatients.length === 0 ? (
              <EmptyState icon={<Users className="h-5 w-5" />} title="No patients yet" />
            ) : (
              <ul className="card divide-y divide-ink-100">
                {data.recentPatients.map((p) => (
                  <li key={p.id}>
                    <Link to={`/patients/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-ink-50">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{p.name}</p>
                        <p className="hint">{p.patientCode}</p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-ink-300" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card card-pad">
            <div className="flex items-center justify-between">
              <div>
                <p className="section-title">Pending payments</p>
                <p className="mt-1 text-2xl font-semibold text-ink-900">{formatCurrency(data.pendingPayments.amount, activeClinic?.currency)}</p>
                <p className="hint">{data.pendingPayments.count} invoice(s) outstanding</p>
              </div>
              <Link to="/billing" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-300 px-3 text-sm font-medium hover:bg-ink-50">
                Billing <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <p className="hint">Last updated {formatDateTime(new Date().toISOString())}</p>
        </section>
      </div>
    </div>
  );
}

function PatientRedirect() {
  const navigate = useNavigate();
  navigate('/me', { replace: true });
  return <InlineSpinner />;
}
