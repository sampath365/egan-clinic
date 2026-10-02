import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, ClipboardList, FlaskConical, Pill, Plus, Save,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { ageFromDob, formatDateTime, humanize } from '@/lib/utils';
import { Avatar, EmptyState, PageHeader, Tabs } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select } from '@/components/ui/Field';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Consultation, Prescription } from '@/types';

export function ConsultationPage() {
  const { id } = useParams<{ id: string }>();
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [tab, setTab] = useState('vitals');

  const { data, isLoading } = useQuery({
    queryKey: ['consultation', id],
    queryFn: () => api.get<{ consultation: Consultation }>(`/consultations/${id}`),
    enabled: Boolean(id),
  });

  const consultation = data?.consultation;
  const patientId = consultation?.patientId;

  const { data: history } = useQuery({
    queryKey: ['patient-history', patientId],
    queryFn: () => api.get<{ prescriptions: Prescription[]; consultations: Consultation[]; vitals: unknown[]; documents: unknown[] }>(`/patients/${patientId}/history`),
    enabled: Boolean(patientId),
  });

  if (isLoading || !consultation) return <InlineSpinner label="Loading consultation…" />;
  const patient = consultation.patient;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={patient?.name} size={40} /> {patient?.name}
          </span>
        }
        subtitle={`${patient?.patientCode} · ${ageFromDob(patient?.dateOfBirth)}${patient?.gender ? ` · ${patient.gender.toLowerCase()}` : ''} · ${consultation.doctor?.name}`}
        actions={
          <>
            <StatusBadge status={consultation.status} />
            {can(PERMISSIONS.CONSULTATION_MANAGE) && consultation.status !== 'COMPLETED' && (
              <CompleteConsultationButton consultationId={consultation.id} />
            )}
          </>
        }
      />

      {(patient?.allergies || patient?.existingConditions || patient?.currentMedications) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {patient?.allergies && <Alert tone="danger" title="Allergies" text={patient.allergies} />}
          {patient?.existingConditions && <Alert tone="warning" title="Existing conditions" text={patient.existingConditions} />}
          {patient?.currentMedications && <Alert tone="info" title="Current medications" text={patient.currentMedications} />}
        </div>
      )}

      <div className="mb-4 max-w-2xl">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'vitals', label: 'Vitals' },
            { key: 'notes', label: 'Clinical notes' },
            { key: 'investigation', label: 'Investigation' },
            { key: 'history', label: 'History' },
            { key: 'prescription', label: 'Prescription' },
          ]}
        />
      </div>

      {tab === 'vitals' && <VitalsPanel consultationId={consultation.id} vitals={consultation.vitals ?? []} />}
      {tab === 'notes' && <NotesPanel consultation={consultation} />}
      {tab === 'investigation' && <InvestigationPanel consultation={consultation} />}

      {tab === 'history' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="card card-pad">
            <h2 className="section-title mb-3">Previous prescriptions</h2>
            {!history?.prescriptions.length ? <p className="text-sm text-ink-500">No previous prescriptions.</p> : (
              <ul className="divide-y divide-ink-100">
                {history.prescriptions.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                    <Link to={`/prescriptions/${p.id}`} className="text-sm font-medium text-brand-700 hover:underline">{p.prescriptionNo}</Link>
                    <span className="hint">{formatDateTime(p.issuedAt ?? p.createdAt)}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card card-pad">
            <h2 className="section-title mb-3">Previous visits</h2>
            {!history?.consultations.length ? <p className="text-sm text-ink-500">No previous visits.</p> : (
              <ul className="divide-y divide-ink-100">
                {history.consultations.map((c) => (
                  <li key={c.id} className="py-2.5">
                    <p className="text-sm font-medium text-ink-800">{formatDateTime(c.startedAt)}</p>
                    <p className="hint">{c.diagnosis ?? c.chiefComplaint ?? 'No diagnosis recorded'}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'prescription' && (
        <PrescriptionPanel consultation={consultation} prescriptions={consultation.prescriptions ?? []} clinicId={activeClinic?.id} />
      )}
    </div>
  );
}

function CompleteConsultationButton({ consultationId }: { consultationId: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () => api.post(`/consultations/${consultationId}/complete`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultation', consultationId] });
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      toast.success('Consultation completed');
    },
    onError: (e) => toast.error('Could not complete', e instanceof ApiError ? e.message : undefined),
  });
  return <Button variant="success" onClick={() => mutation.mutate()} loading={mutation.isPending}><CheckCircle2 className="h-4 w-4" /> Complete</Button>;
}

function VitalsPanel({ consultationId, vitals }: { consultationId: string; vitals: NonNullable<Consultation['vitals']> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const [form, setForm] = useState({ temperature: '', bpSystolic: '', bpDiastolic: '', pulse: '', spo2: '', weightKg: '', heightCm: '', respiratoryRate: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

  const mutation = useMutation({
    mutationFn: () => api.post(`/consultations/${consultationId}/vitals`, {
      temperature: num(form.temperature), bpSystolic: num(form.bpSystolic), bpDiastolic: num(form.bpDiastolic),
      pulse: num(form.pulse), spo2: num(form.spo2), weightKg: num(form.weightKg), heightCm: num(form.heightCm),
      respiratoryRate: num(form.respiratoryRate),
    }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultation', consultationId] });
      toast.success('Vitals recorded');
      setForm({ temperature: '', bpSystolic: '', bpDiastolic: '', pulse: '', spo2: '', weightKg: '', heightCm: '', respiratoryRate: '' });
    },
    onError: (e) => toast.error('Could not save vitals', e instanceof ApiError ? e.message : undefined),
  });

  const bmi = num(form.weightKg) && num(form.heightCm)
    ? Math.round((Number(form.weightKg) / ((Number(form.heightCm) / 100) ** 2)) * 10) / 10
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card card-pad">
        <h2 className="section-title mb-3">Record vitals</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Temperature (°C)"><Input inputMode="decimal" value={form.temperature} onChange={(e) => set('temperature', e.target.value)} /></Field>
          <Field label="Respiratory rate (/min)"><Input inputMode="numeric" value={form.respiratoryRate} onChange={(e) => set('respiratoryRate', e.target.value)} /></Field>
          <Field label="BP systolic"><Input inputMode="numeric" value={form.bpSystolic} onChange={(e) => set('bpSystolic', e.target.value)} /></Field>
          <Field label="BP diastolic"><Input inputMode="numeric" value={form.bpDiastolic} onChange={(e) => set('bpDiastolic', e.target.value)} /></Field>
          <Field label="Pulse (/min)"><Input inputMode="numeric" value={form.pulse} onChange={(e) => set('pulse', e.target.value)} /></Field>
          <Field label="SpO₂ (%)"><Input inputMode="numeric" value={form.spo2} onChange={(e) => set('spo2', e.target.value)} /></Field>
          <Field label="Weight (kg)"><Input inputMode="decimal" value={form.weightKg} onChange={(e) => set('weightKg', e.target.value)} /></Field>
          <Field label="Height (cm)" hint={bmi ? `BMI ${bmi}` : undefined}><Input inputMode="decimal" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} /></Field>
        </div>
        <Button className="mt-4" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!can(PERMISSIONS.VITALS_MANAGE)}>
          <Save className="h-4 w-4" /> Save vitals
        </Button>
      </div>

      <div className="card card-pad">
        <h2 className="section-title mb-3">Recorded vitals</h2>
        {vitals.length === 0 ? <p className="text-sm text-ink-500">No vitals recorded for this visit yet.</p> : (
          <ul className="divide-y divide-ink-100">
            {vitals.map((v) => (
              <li key={v.id} className="py-2.5 text-sm">
                <p className="hint mb-1">{formatDateTime(v.recordedAt)}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-800">
                  {v.temperature != null && <span>Temp {v.temperature}°C</span>}
                  {v.bpSystolic != null && <span>BP {v.bpSystolic}/{v.bpDiastolic}</span>}
                  {v.pulse != null && <span>Pulse {v.pulse}</span>}
                  {v.spo2 != null && <span>SpO₂ {v.spo2}%</span>}
                  {v.weightKg != null && <span>Weight {v.weightKg} kg</span>}
                  {v.bmi != null && <span>BMI {v.bmi}</span>}
                  {v.respiratoryRate != null && <span>RR {v.respiratoryRate}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NotesPanel({ consultation }: { consultation: Consultation }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const [form, setForm] = useState({
    chiefComplaint: consultation.chiefComplaint ?? '',
    symptoms: consultation.symptoms ?? '',
    history: consultation.history ?? '',
    examination: consultation.examination ?? '',
    diagnosis: consultation.diagnosis ?? '',
    doctorNotes: consultation.doctorNotes ?? '',
    advice: consultation.advice ?? '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.patch(`/consultations/${consultation.id}`, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultation', consultation.id] });
      toast.success('Notes saved');
    },
    onError: (e) => toast.error('Could not save notes', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="card card-pad">
      <h2 className="section-title mb-3">Clinical notes</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Chief complaint"><Textarea rows={2} value={form.chiefComplaint} onChange={(e) => set('chiefComplaint', e.target.value)} /></Field>
        <Field label="Symptoms"><Textarea rows={2} value={form.symptoms} onChange={(e) => set('symptoms', e.target.value)} /></Field>
        <Field label="History"><Textarea rows={3} value={form.history} onChange={(e) => set('history', e.target.value)} /></Field>
        <Field label="Examination"><Textarea rows={3} value={form.examination} onChange={(e) => set('examination', e.target.value)} /></Field>
        <Field label="Diagnosis"><Textarea rows={2} value={form.diagnosis} onChange={(e) => set('diagnosis', e.target.value)} /></Field>
        <Field label="Advice"><Textarea rows={2} value={form.advice} onChange={(e) => set('advice', e.target.value)} /></Field>
      </div>
      <Field label="Doctor notes" className="mt-3"><Textarea rows={3} value={form.doctorNotes} onChange={(e) => set('doctorNotes', e.target.value)} /></Field>
      <Button className="mt-4" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!can(PERMISSIONS.CONSULTATION_MANAGE)}>
        <Save className="h-4 w-4" /> Save notes
      </Button>
    </div>
  );
}

function InvestigationPanel({ consultation }: { consultation: Consultation }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { can } = usePermissions();
  const [type, setType] = useState('LAB');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/consultations/${consultation.id}/investigations`, { type, name, instructions: instructions || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['consultation', consultation.id] });
      toast.success('Investigation added');
      setName(''); setInstructions('');
    },
    onError: (e) => toast.error('Could not add investigation', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card card-pad">
        <h2 className="section-title mb-3">Order investigation</h2>
        <div className="space-y-3">
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {['LAB', 'SCAN', 'OTHER', 'REFERRAL'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
            </Select>
          </Field>
          <Field label="Name" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. CBC, Chest X-ray" /></Field>
          <Field label="Instructions"><Textarea rows={2} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!name.trim() || !can(PERMISSIONS.CONSULTATION_MANAGE)}>
            <Plus className="h-4 w-4" /> Add investigation
          </Button>
        </div>
      </div>
      <div className="card card-pad">
        <h2 className="section-title mb-3">Ordered</h2>
        {!consultation.investigations?.length ? <p className="text-sm text-ink-500">No investigations ordered.</p> : (
          <ul className="divide-y divide-ink-100">
            {consultation.investigations.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-ink-400" />
                  <span className="text-sm font-medium text-ink-800">{i.name}</span>
                </div>
                <StatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PrescriptionPanel({ consultation, prescriptions, clinicId }: { consultation: Consultation; prescriptions: Prescription[]; clinicId?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const create = useMutation({
    mutationFn: () => api.post<{ prescription: Prescription }>('/prescriptions', {
      clinicId, patientId: consultation.patientId, doctorId: consultation.doctorId, consultationId: consultation.id,
    }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['prescriptions'] });
      toast.success('Draft prescription created', 'Add medicines, handwriting or voice notes, then sign to issue.');
      navigate(`/prescriptions/${res.prescription.id}/edit`);
    },
    onError: (e) => toast.error('Could not create prescription', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="card card-pad flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><ClipboardList className="h-5 w-5" /></span>
          <div>
            <p className="text-sm font-semibold text-ink-900">Create prescription</p>
            <p className="hint">Type medicines, write by hand or dictate — then review and sign.</p>
          </div>
        </div>
        {can(PERMISSIONS.PRESCRIPTION_CREATE) && (
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={consultation.status === 'COMPLETED'}>
            <Plus className="h-4 w-4" /> New prescription
          </Button>
        )}
      </div>

      {prescriptions.length === 0 ? (
        <EmptyState icon={<Pill className="h-5 w-5" />} title="No prescriptions for this visit" />
      ) : (
        <ul className="space-y-2">
          {prescriptions.map((p) => (
            <li key={p.id}>
              <Link to={`/prescriptions/${p.id}`} className="card card-pad flex items-center justify-between hover:bg-ink-50">
                <div>
                  <p className="text-sm font-medium text-ink-900">{p.prescriptionNo}</p>
                  <p className="hint">Version {p.versions[0]?.version ?? 1} · {formatDateTime(p.issuedAt ?? p.createdAt)}</p>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Alert({ tone, title, text }: { tone: 'danger' | 'warning' | 'info'; title: string; text: string }) {
  const tones = { danger: 'border-red-200 bg-red-50 text-red-800', warning: 'border-amber-200 bg-amber-50 text-amber-800', info: 'border-sky-200 bg-sky-50 text-sky-800' };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <p className="mt-0.5 text-sm">{text}</p>
    </div>
  );
}
