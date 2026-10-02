import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Plus, Save, Stethoscope } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatCurrency } from '@/lib/utils';
import { Avatar, PageHeader, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { Doctor } from '@/types';

export function DoctorsPage() {
  const { activeClinic } = useAuth();
  const qc = useQueryClient();
  const clinicId = activeClinic?.id;
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [creating, setCreating] = useState(false);
  const [leaveFor, setLeaveFor] = useState<Doctor | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['doctors', clinicId],
    queryFn: () => api.get<{ doctors: Doctor[] }>('/doctors', { clinicId }),
    enabled: Boolean(clinicId),
  });

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle="Profiles, fees and availability"
        actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add doctor</Button>}
      />

      {isLoading ? <InlineSpinner /> : !data?.doctors.length ? (
        <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No doctors yet" message="Add the doctors who practise at this clinic." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.doctors.map((d) => (
            <div key={d.id} className="card card-pad">
              <div className="flex items-center gap-3">
                <Avatar name={d.name} size={44} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{d.name}</p>
                  <p className="hint truncate">{d.specialization}</p>
                </div>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-ink-500">Qualification</dt><dd className="text-ink-800">{d.qualification ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Registration</dt><dd className="text-ink-800">{d.registrationNo ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Consultation fee</dt><dd className="text-ink-800">{formatCurrency(d.consultationFee, activeClinic?.currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Available days</dt><dd className="text-ink-800">{d.availableDays ?? '—'}</dd></div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="secondary" onClick={() => setEditing(d)}>Edit profile</Button>
                <Button size="sm" variant="ghost" onClick={() => setLeaveFor(d)}><CalendarOff className="h-3.5 w-3.5" /> Leave</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <DoctorModal
          doctor={editing}
          clinicId={clinicId}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={() => { void qc.invalidateQueries({ queryKey: ['doctors'] }); setCreating(false); setEditing(null); }}
        />
      )}

      {leaveFor && <LeaveModal doctor={leaveFor} onClose={() => setLeaveFor(null)} onDone={() => { void qc.invalidateQueries({ queryKey: ['doctors'] }); setLeaveFor(null); }} />}
    </div>
  );
}

function DoctorModal({ doctor, clinicId, onClose, onDone }: { doctor: Doctor | null; clinicId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: doctor?.name ?? '',
    specialization: doctor?.specialization ?? '',
    qualification: doctor?.qualification ?? '',
    registrationNo: doctor?.registrationNo ?? '',
    phone: doctor?.phone ?? '',
    email: doctor?.email ?? '',
    consultationFee: String(doctor?.consultationFee ?? 500),
    followUpFee: String(doctor?.followUpFee ?? 300),
    availableDays: doctor?.availableDays ?? 'MON,TUE,WED,THU,FRI',
    prescriptionHeader: doctor?.prescriptionHeader ?? '',
    prescriptionFooter: doctor?.prescriptionFooter ?? '',
    defaultMedicineInstructions: doctor?.defaultMedicineInstructions ?? '',
    defaultFollowUpDays: String(doctor?.defaultFollowUpDays ?? 7),
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        clinicId,
        name: form.name,
        specialization: form.specialization || undefined,
        qualification: form.qualification || undefined,
        registrationNo: form.registrationNo || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        consultationFee: Number(form.consultationFee) || 0,
        followUpFee: Number(form.followUpFee) || 0,
        availableDays: form.availableDays || undefined,
        prescriptionHeader: form.prescriptionHeader || undefined,
        prescriptionFooter: form.prescriptionFooter || undefined,
        defaultMedicineInstructions: form.defaultMedicineInstructions || undefined,
        defaultFollowUpDays: Number(form.defaultFollowUpDays) || undefined,
      };
      return doctor ? api.patch(`/doctors/${doctor.id}`, payload) : api.post('/doctors', payload);
    },
    onSuccess: () => { toast.success(doctor ? 'Doctor updated' : 'Doctor added'); onDone(); },
    onError: (e) => toast.error('Could not save doctor', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal open onClose={onClose} title={doctor ? 'Edit doctor' : 'Add doctor'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.name.trim()}><Save className="h-4 w-4" /> Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Specialization"><Input value={form.specialization} onChange={(e) => set('specialization', e.target.value)} /></Field>
        <Field label="Qualification"><Input value={form.qualification} onChange={(e) => set('qualification', e.target.value)} /></Field>
        <Field label="Registration number"><Input value={form.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Consultation fee"><Input inputMode="decimal" value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} /></Field>
        <Field label="Follow-up fee"><Input inputMode="decimal" value={form.followUpFee} onChange={(e) => set('followUpFee', e.target.value)} /></Field>
        <Field label="Available days" hint="Comma separated, e.g. MON,TUE,WED"><Input value={form.availableDays} onChange={(e) => set('availableDays', e.target.value)} /></Field>
        <Field label="Default follow-up (days)"><Input inputMode="numeric" value={form.defaultFollowUpDays} onChange={(e) => set('defaultFollowUpDays', e.target.value)} /></Field>
        <Field label="Prescription header" className="sm:col-span-2"><Textarea rows={2} value={form.prescriptionHeader} onChange={(e) => set('prescriptionHeader', e.target.value)} /></Field>
        <Field label="Prescription footer" className="sm:col-span-2"><Textarea rows={2} value={form.prescriptionFooter} onChange={(e) => set('prescriptionFooter', e.target.value)} /></Field>
        <Field label="Default medicine instructions" className="sm:col-span-2"><Input value={form.defaultMedicineInstructions} onChange={(e) => set('defaultMedicineInstructions', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function LeaveModal({ doctor, onClose, onDone }: { doctor: Doctor; onClose: () => void; onDone: () => void }) {
  const [fromDate, setFromDate] = useState(new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const toast = useToast();
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/doctors/${doctor.id}/leaves`, { fromDate: new Date(fromDate).toISOString(), toDate: new Date(toDate).toISOString(), reason: reason || undefined }),
    onSuccess: () => { toast.success('Leave recorded', `${doctor.name} is unavailable for the selected dates.`); onDone(); },
    onError: (e) => toast.error('Could not record leave', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal open onClose={onClose} title={`Leave — ${doctor.name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending}>Record leave</Button></>}>
      <div className="space-y-3">
        <Field label="From"><Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Personal leave" /></Field>
        <p className="hint">Bookings are not blocked automatically — reschedule affected appointments as needed.</p>
        <p className="hint">Selected: {formatDate(fromDate)} → {formatDate(toDate)}</p>
      </div>
    </Modal>
  );
}
