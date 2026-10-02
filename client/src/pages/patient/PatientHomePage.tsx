import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, FileText, Receipt, Stethoscope, User } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader, StatCard, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { Appointment, Consultation, Invoice, Prescription } from '@/types';

/** Resolves the patient record linked to the signed-in user. */
export function useMyPatient() {
  return useQuery({
    queryKey: ['my-patient'],
    queryFn: async () => {
      const { user } = await api.get<{ user: { scopes: { patientIds: string[] } } }>('/auth/me');
      const id = user.scopes.patientIds[0];
      if (!id) return null;
      const res = await api.get<{ patient: { id: string; name: string; patientCode: string; dateOfBirth?: string | null; gender?: string | null; mobile?: string | null; email?: string | null; address?: string | null; bloodGroup?: string | null; allergies?: string | null; existingConditions?: string | null; currentMedications?: string | null } }>(`/patients/${id}`);
      return res.patient;
    },
  });
}

export function PatientHomePage() {
  const { data: me, isLoading } = useMyPatient();
  const patientId = me?.id;

  const { data: prescriptions } = useQuery({
    queryKey: ['my-prescriptions', patientId],
    queryFn: () => api.get<{ items: Prescription[] }>('/prescriptions', { patientId }),
    enabled: Boolean(patientId),
  });
  const { data: appointments } = useQuery({
    queryKey: ['my-appointments', patientId],
    queryFn: () => api.get<{ items: Appointment[] }>('/appointments', { patientId }),
    enabled: Boolean(patientId),
  });
  const { data: invoices } = useQuery({
    queryKey: ['my-invoices', patientId],
    queryFn: () => api.get<{ items: Invoice[] }>('/billing/invoices', { patientId }),
    enabled: Boolean(patientId),
  });

  if (isLoading) return <InlineSpinner label="Loading your records…" />;
  if (!me) return <EmptyState icon={<User className="h-5 w-5" />} title="No patient record linked" message="Your account is not linked to a patient record yet." />;

  const upcoming = (appointments?.items ?? []).filter((a) => new Date(a.scheduledAt) >= new Date() && !['CANCELLED', 'COMPLETED'].includes(a.status));
  const outstanding = (invoices?.items ?? []).reduce((s, i) => s + i.balance, 0);

  return (
    <div>
      <PageHeader title={`Hello, ${me.name.split(' ')[0]}`} subtitle={`${me.patientCode} · your health records at a glance`} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Upcoming visits" value={upcoming.length} icon={<CalendarDays className="h-5 w-5" />} onClick={() => undefined} />
        <StatCard label="Prescriptions" value={prescriptions?.items.length ?? 0} tone="brand" icon={<ClipboardList className="h-5 w-5" />} />
        <StatCard label="Outstanding" value={outstanding.toFixed(2)} tone={outstanding > 0 ? 'warning' : 'success'} icon={<Receipt className="h-5 w-5" />} />
        <StatCard label="Visits" value={appointments?.items.filter((a) => a.status === 'COMPLETED').length ?? 0} tone="info" icon={<Stethoscope className="h-5 w-5" />} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section>
          <h2 className="section-title mb-2">Upcoming appointments</h2>
          {upcoming.length === 0 ? <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No upcoming appointments" /> : (
            <ul className="card divide-y divide-ink-100">
              {upcoming.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-ink-900">{a.doctor?.name}</p>
                    <p className="hint">{formatDateTime(a.scheduledAt)}</p>
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="section-title mb-2">Recent prescriptions</h2>
          {!prescriptions?.items.length ? <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No prescriptions yet" /> : (
            <ul className="card divide-y divide-ink-100">
              {prescriptions.items.slice(0, 4).map((p) => (
                <li key={p.id}>
                  <Link to={`/prescriptions/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-ink-50">
                    <div>
                      <p className="text-sm font-medium text-ink-900">{p.prescriptionNo}</p>
                      <p className="hint">{p.doctor?.name} · {formatDateTime(p.issuedAt ?? p.createdAt)}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <PortalLink to="/me/prescriptions" icon={<ClipboardList className="h-5 w-5" />} title="Prescriptions" />
        <PortalLink to="/me/documents" icon={<FileText className="h-5 w-5" />} title="Reports" />
        <PortalLink to="/me/profile" icon={<User className="h-5 w-5" />} title="My profile" />
      </div>
    </div>
  );
}

function PortalLink({ to, icon, title }: { to: string; icon: React.ReactNode; title: string }) {
  return (
    <Link to={to} className="card card-pad flex items-center gap-3 hover:shadow-pop">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span className="text-sm font-medium text-ink-800">{title}</span>
    </Link>
  );
}

export function useMyConsultations(patientId?: string) {
  return useQuery({
    queryKey: ['my-consultations', patientId],
    queryFn: () => api.get<{ consultations: Consultation[] }>('/consultations', { patientId }),
    enabled: Boolean(patientId),
  });
}
