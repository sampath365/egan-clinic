import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatCurrency, formatDate, humanize } from '@/lib/utils';
import { PageHeader, StatCard, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Field, Input } from '@/components/ui/Field';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { PharmacyPrescription } from '@/types';

const COLORS = ['#0f8372', '#40bfa5', '#f59e0b', '#ef4444', '#66738e', '#1d4ed8', '#a855f7'];

export function ReportsPage() {
  const { activeClinic } = useAuth();
  const clinicId = activeClinic?.id;
  const currency = activeClinic?.currency ?? 'INR';
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  const params = { clinicId, from, to };

  const { data: patients, isLoading } = useQuery({ queryKey: ['report-patients', params], queryFn: () => api.get<{ totalPatients: number; newPatients: number; series: Array<{ date: string; count: number }> }>('/reports/patients', params), enabled: Boolean(clinicId) });
  const { data: appointments } = useQuery({ queryKey: ['report-appointments', params], queryFn: () => api.get<{ byStatus: Array<{ status: string; count: number }>; total: number }>('/reports/appointments', params), enabled: Boolean(clinicId) });
  const { data: revenue } = useQuery({ queryKey: ['report-revenue', params], queryFn: () => api.get<{ totalCollected: number; netRevenue: number; byMethod: Array<{ method: string; amount: number; count: number }>; outstanding: { count: number; amount: number } }>('/reports/revenue', params), enabled: Boolean(clinicId) });
  const { data: prescriptions } = useQuery({ queryKey: ['report-rx', params], queryFn: () => api.get<{ total: number; byStatus: Array<{ status: string; count: number }>; totalShares: number; pharmacyForwarded: number }>('/reports/prescriptions', params), enabled: Boolean(clinicId) });
  const { data: doctors } = useQuery({ queryKey: ['report-doctors', params], queryFn: () => api.get<{ doctors: Array<{ id: string; name: string; appointments: number; consultations: number; prescriptions: number }> }>('/reports/doctors', params), enabled: Boolean(clinicId) });
  const { data: pharmacy } = useQuery({ queryKey: ['report-pharmacy', params], queryFn: () => api.get<{ enabled: boolean; items: PharmacyPrescription[] }>('/reports/pharmacy-prescriptions', params), enabled: Boolean(clinicId) && Boolean(activeClinic?.medicalShopEnabled) });
  const { data: followUps } = useQuery({ queryKey: ['report-followups', params], queryFn: () => api.get<{ byStatus: Array<{ status: string; count: number }> }>('/reports/follow-ups', params), enabled: Boolean(clinicId) });
  const { data: consultations } = useQuery({ queryKey: ['report-consultations', params], queryFn: () => api.get<{ total: number; completed: number; withDiagnosis: number; byStatus: Array<{ status: string; count: number }> }>('/reports/consultations', params), enabled: Boolean(clinicId) });
  const { data: outstanding } = useQuery({ queryKey: ['report-outstanding', clinicId], queryFn: () => api.get<{ items: Array<{ id: string; invoiceNo: string; balance: number; patient?: { name: string; patientCode: string } }>; total: number; count: number }>('/reports/outstanding-payments', { clinicId }), enabled: Boolean(clinicId) });
  const { data: cancelled } = useQuery({ queryKey: ['report-cancelled', params], queryFn: () => api.get<{ items: Array<{ id: string; scheduledAt: string; status: string; patient?: { name: string }; doctor?: { name: string } }> }>('/reports/cancelled-appointments', params), enabled: Boolean(clinicId) });

  if (isLoading) return <InlineSpinner label="Building reports…" />;

  return (
    <div>
      <PageHeader title="Reports" subtitle="Clinic activity, revenue and prescriptions" />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:max-w-xl">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total patients" value={patients?.totalPatients ?? 0} hint={`${patients?.newPatients ?? 0} new in range`} icon={<BarChart3 className="h-5 w-5" />} />
        <StatCard label="Appointments" value={appointments?.total ?? 0} icon={<BarChart3 className="h-5 w-5" />} />
        <StatCard label="Net revenue" value={formatCurrency(revenue?.netRevenue ?? 0, currency)} tone="success" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard label="Outstanding" value={formatCurrency(revenue?.outstanding.amount ?? 0, currency)} tone="warning" hint={`${revenue?.outstanding.count ?? 0} invoices`} icon={<BarChart3 className="h-5 w-5" />} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">New patients</h2>
          {!patients?.series.length ? <p className="text-sm text-ink-500">No patient registrations in this range.</p> : (
            <div className="h-64 w-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={patients.series}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef2" />
                  <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip labelFormatter={(d) => formatDate(String(d))} />
                  <Bar dataKey="count" name="Patients" fill="#0f8372" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">Appointments by status</h2>
          {!appointments?.byStatus.length ? <p className="text-sm text-ink-500">No appointments in this range.</p> : (
            <div className="h-64 w-full min-w-0 overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={appointments.byStatus.map((s) => ({ name: humanize(s.status), value: s.count }))} dataKey="value" nameKey="name" outerRadius={90} label>
                    {appointments.byStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">Revenue by method</h2>
          {!revenue?.byMethod.length ? <p className="text-sm text-ink-500">No payments in this range.</p> : (
            <ul className="divide-y divide-ink-100">
              {revenue.byMethod.map((m) => (
                <li key={m.method} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-ink-700">{humanize(m.method)} <span className="hint">({m.count})</span></span>
                  <span className="font-semibold text-ink-900">{formatCurrency(m.amount, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">Prescriptions</h2>
          <p className="text-sm text-ink-600">Total issued in range: <span className="font-semibold text-ink-900">{prescriptions?.total ?? 0}</span></p>
          {prescriptions?.byStatus.length ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {prescriptions.byStatus.map((s) => (
                <li key={s.status} className="flex justify-between"><span className="text-ink-600">{humanize(s.status)}</span><span className="font-medium text-ink-900">{s.count}</span></li>
              ))}
            </ul>
          ) : <p className="text-sm text-ink-500">No prescriptions in this range.</p>}
          <p className="hint mt-3">Shares: {prescriptions?.totalShares ?? 0}{activeClinic?.medicalShopEnabled ? ` · Forwarded to pharmacy: ${prescriptions?.pharmacyForwarded ?? 0}` : ''}</p>
        </section>

        <section className="card card-pad lg:col-span-2">
          <h2 className="section-title mb-3">Doctor activity</h2>
          {!doctors?.doctors.length ? <p className="text-sm text-ink-500">No doctor activity in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">Doctor</th><th className="py-2 text-right">Appointments</th><th className="py-2 text-right">Consultations</th><th className="py-2 text-right">Prescriptions</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {doctors.doctors.map((d) => (
                    <tr key={d.id}>
                      <td className="py-2.5 font-medium text-ink-800">{d.name}</td>
                      <td className="py-2.5 text-right">{d.appointments}</td>
                      <td className="py-2.5 text-right">{d.consultations}</td>
                      <td className="py-2.5 text-right">{d.prescriptions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {activeClinic?.medicalShopEnabled && (
          <section className="card card-pad lg:col-span-2">
            <h2 className="section-title mb-3">Pharmacy prescriptions</h2>
            {!pharmacy?.items.length ? <p className="text-sm text-ink-500">No prescriptions forwarded to the medical shop in this range.</p> : (
              <ul className="divide-y divide-ink-100">
                {pharmacy.items.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span>{p.prescription?.prescriptionNo} · {p.prescription?.patient?.name}</span>
                    <span className="text-ink-600">{humanize(p.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section className="card card-pad lg:col-span-2">
          <h2 className="section-title mb-3">Follow-ups</h2>
          {!followUps?.byStatus.length ? <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No follow-ups in this range" /> : (
            <ul className="flex flex-wrap gap-3">
              {followUps.byStatus.map((s) => (
                <li key={s.status} className="rounded-lg border border-ink-200 px-4 py-2 text-sm">
                  <span className="text-ink-600">{humanize(s.status)}</span> <span className="ml-2 font-semibold text-ink-900">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">Consultation report</h2>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <div><p className="hint">Total</p><p className="text-lg font-semibold text-ink-900">{consultations?.total ?? 0}</p></div>
            <div><p className="hint">Completed</p><p className="text-lg font-semibold text-ink-900">{consultations?.completed ?? 0}</p></div>
            <div><p className="hint">With diagnosis</p><p className="text-lg font-semibold text-ink-900">{consultations?.withDiagnosis ?? 0}</p></div>
          </div>
        </section>

        <section className="card card-pad min-w-0">
          <h2 className="section-title mb-3">Outstanding payments</h2>
          <p className="text-sm text-ink-600">Total due: <span className="font-semibold text-ink-900">{formatCurrency(outstanding?.total ?? 0, currency)}</span> across {outstanding?.count ?? 0} invoice(s).</p>
          {outstanding?.items.length ? (
            <ul className="mt-3 divide-y divide-ink-100">
              {outstanding.items.slice(0, 8).map((i) => (
                <li key={i.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{i.patient?.name} <span className="hint">{i.invoiceNo}</span></span>
                  <span className="font-medium text-amber-700">{formatCurrency(i.balance, currency)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-ink-500">Nothing outstanding.</p>}
        </section>

        <section className="card card-pad lg:col-span-2">
          <h2 className="section-title mb-3">Cancelled & no-show appointments</h2>
          {!cancelled?.items.length ? <p className="text-sm text-ink-500">No cancellations in this range.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <tr><th className="py-2">When</th><th className="py-2">Patient</th><th className="py-2">Doctor</th><th className="py-2">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {cancelled.items.slice(0, 20).map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 text-ink-700">{formatDate(a.scheduledAt)}</td>
                      <td className="py-2.5 text-ink-800">{a.patient?.name}</td>
                      <td className="py-2.5 text-ink-700">{a.doctor?.name}</td>
                      <td className="py-2.5"><StatusBadge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
