import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Clock, ListOrdered, XCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Search } from '@/components/ui/Search';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Appointment, Doctor, Paginated, Patient } from '@/types';

const todayKey = () => new Date().toISOString().slice(0, 10);

export function AppointmentsPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const clinicId = activeClinic?.id;

  const [date, setDate] = useState(todayKey());
  const [statusFilter, setStatusFilter] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [booking, setBooking] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['appointments', clinicId, date, statusFilter, doctorFilter],
    queryFn: () => api.get<Paginated<Appointment>>('/appointments', { clinicId, date, status: statusFilter, doctorId: doctorFilter, pageSize: 100 }),
    enabled: Boolean(clinicId),
  });

  const { data: doctors } = useQuery({
    queryKey: ['doctors', clinicId],
    queryFn: () => api.get<{ doctors: Doctor[] }>('/doctors', { clinicId, activeOnly: true }),
    enabled: Boolean(clinicId),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/appointments/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Appointment updated');
    },
    onError: (e) => toast.error('Could not update appointment', e instanceof ApiError ? e.message : undefined),
  });

  const queueMutation = useMutation({
    mutationFn: (appt: Appointment) => api.post('/queue', { clinicId, patientId: appt.patientId, doctorId: appt.doctorId, appointmentId: appt.id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      toast.success('Token issued', 'The patient has been added to the queue.');
    },
    onError: (e) => toast.error('Could not issue token', e instanceof ApiError ? e.message : undefined),
  });

  const columns: Column<Appointment>[] = useMemo(() => [
    { key: 'time', header: 'Time', render: (a) => <span className="font-medium text-ink-900">{formatTime(a.scheduledAt)}</span> },
    {
      key: 'patient', header: 'Patient',
      render: (a) => (
        <div>
          <p className="font-medium text-ink-900">{a.patient?.name}</p>
          <p className="hint">{a.patient?.patientCode}{a.reason ? ` · ${a.reason}` : ''}</p>
        </div>
      ),
    },
    { key: 'doctor', header: 'Doctor', render: (a) => <span>{a.doctor?.name}</span> },
    { key: 'type', header: 'Type', render: (a) => <StatusBadge status={a.type} tone="neutral" /> },
    { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (a) => (
        <div className="flex items-center justify-end gap-1.5">
          {can(PERMISSIONS.QUEUE_MANAGE) && !a.queueToken && !['CANCELLED', 'COMPLETED'].includes(a.status) && (
            <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); queueMutation.mutate(a); }}>
              <ListOrdered className="h-3.5 w-3.5" /> Token
            </Button>
          )}
          {can(PERMISSIONS.APPOINTMENT_MANAGE) && a.status === 'BOOKED' && (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: a.id, status: 'CONFIRMED' }); }} title="Confirm">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </Button>
          )}
          {can(PERMISSIONS.APPOINTMENT_MANAGE) && !['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(a.status) && (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); statusMutation.mutate({ id: a.id, status: 'NO_SHOW' }); }} title="Mark no-show">
              <XCircle className="h-4 w-4 text-ink-400" />
            </Button>
          )}
        </div>
      ),
    },
  ], [can, queueMutation, statusMutation]);

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Bookings, walk-ins and confirmations for the selected day"
        actions={
          can(PERMISSIONS.APPOINTMENT_MANAGE) && (
            <Button onClick={() => setBooking(true)}><CalendarPlus className="h-4 w-4" /> New appointment</Button>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Doctor">
          <Select value={doctorFilter} onChange={(e) => setDoctorFilter(e.target.value)}>
            <option value="">All doctors</option>
            {doctors?.doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'].map((s) => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </Select>
        </Field>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(a) => a.id}
        loading={isLoading}
        empty={<EmptyState icon={<Clock className="h-5 w-5" />} title="No appointments" message="Nothing is scheduled for this filter." />}
      />

      <BookAppointmentModal open={booking} onClose={() => setBooking(false)} clinicId={clinicId} doctors={doctors?.doctors ?? []} defaultDate={date} />
    </div>
  );
}

function BookAppointmentModal({ open, onClose, clinicId, doctors, defaultDate }: { open: boolean; onClose: () => void; clinicId?: string; doctors: Doctor[]; defaultDate: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [scheduledAt, setScheduledAt] = useState(`${defaultDate}T10:00`);
  const [reason, setReason] = useState('');
  const [type, setType] = useState('CONSULTATION');

  const { data: patients } = useQuery({
    queryKey: ['patients-picker', clinicId, search],
    queryFn: () => api.get<Paginated<Patient>>('/patients', { clinicId, search, pageSize: 8 }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api.post<{ appointment: Appointment }>('/appointments', {
      clinicId, patientId, doctorId, scheduledAt: new Date(scheduledAt).toISOString(), reason, type, source: 'RECEPTION',
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Appointment booked', 'The patient has been notified.');
      onClose();
      setPatientId(''); setReason('');
    },
    onError: (e) => toast.error('Could not book appointment', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New appointment"
      description="Search for an existing patient or register one first."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!patientId || !doctorId || !scheduledAt}>Book appointment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Patient" required>
          <Search value={search} onChange={setSearch} placeholder="Search by name, ID or mobile" />
          <div className="scroll-thin mt-2 max-h-44 space-y-1 overflow-y-auto">
            {patients?.items.length === 0 && <p className="hint px-1 py-2">No matching patients. Register the patient first from the Patients page.</p>}
            {patients?.items.map((p) => (
              <button
                key={p.id}
                onClick={() => setPatientId(p.id)}
                className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${patientId === p.id ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:bg-ink-50'}`}
              >
                <span className="font-medium text-ink-800">{p.name}</span>
                <span className="hint">{p.patientCode} · {p.mobile ?? '—'}</span>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Doctor" required>
            <Select value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">Select a doctor</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.name} — {d.specialization}</option>)}
            </Select>
          </Field>
          <Field label="Appointment type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'OTHER'].map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </Select>
          </Field>
        </div>

        <Field label="Date & time" required>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </Field>
        <Field label="Reason for visit">
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fever and body ache" />
        </Field>
        <p className="hint">Booked on {formatDate(new Date(scheduledAt))} at {formatTime(new Date(scheduledAt))}</p>
      </div>
    </Modal>
  );
}
