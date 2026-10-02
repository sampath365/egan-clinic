import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, Pill, Stethoscope, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { ageFromDob, formatDate, formatDateTime, humanize } from '@/lib/utils';
import { Avatar, EmptyState, PageHeader, Tabs } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { InlineSpinner } from '@/components/ui/Spinner';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Appointment, Consultation, MedicalDocument, Patient, Prescription, Vital } from '@/types';

interface HistoryBundle {
  consultations: Consultation[];
  prescriptions: Prescription[];
  vitals: Vital[];
  documents: MedicalDocument[];
  appointments: Appointment[];
}

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [familyOpen, setFamilyOpen] = useState(false);

  const { data: patientData, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => api.get<{ patient: Patient & { asPrimary?: Array<{ id: string; relation: string; canViewRecords: boolean; member: Patient }>; asMember?: Array<{ id: string; relation: string; primary: Patient }> } }>(`/patients/${id}`),
    enabled: Boolean(id),
  });

  const { data: history } = useQuery({
    queryKey: ['patient-history', id],
    queryFn: () => api.get<HistoryBundle>(`/patients/${id}/history`),
    enabled: Boolean(id),
  });

  const startConsultation = useMutation({
    mutationFn: async () => {
      const { doctors } = await api.get<{ doctors: Array<{ id: string; userId?: string | null; name: string }> }>('/doctors', { clinicId: activeClinic?.id, activeOnly: true });
      const mine = doctors.find((d) => d.userId) ?? doctors[0];
      if (!mine) throw new ApiError(400, 'NO_DOCTOR', 'No doctor is available in this clinic');
      return api.post<{ consultation: Consultation }>('/consultations', {
        clinicId: activeClinic?.id, patientId: id, doctorId: mine.id,
      });
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['consultations'] });
      toast.success('Consultation started');
      navigate(`/consultations/${res.consultation.id}`);
    },
    onError: (e) => toast.error('Could not start consultation', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading || !patientData) return <InlineSpinner label="Loading patient…" />;
  const patient = patientData.patient;

  return (
    <div>
      <button onClick={() => navigate('/patients')} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> All patients
      </button>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Avatar name={patient.name} size={40} /> {patient.name}
          </span>
        }
        subtitle={`${patient.patientCode} · ${ageFromDob(patient.dateOfBirth)}${patient.gender ? ` · ${patient.gender.toLowerCase()}` : ''}${patient.bloodGroup ? ` · ${patient.bloodGroup}` : ''}`}
        actions={
          <>
            {can(PERMISSIONS.CONSULTATION_MANAGE) && (
              <Button onClick={() => startConsultation.mutate()} loading={startConsultation.isPending}>
                <Stethoscope className="h-4 w-4" /> Start consultation
              </Button>
            )}
            {can(PERMISSIONS.PATIENT_FAMILY_MANAGE) && (
              <Button variant="secondary" onClick={() => setFamilyOpen(true)}><UserPlus className="h-4 w-4" /> Link family</Button>
            )}
          </>
        }
      />

      {/* Clinical alerts */}
      {(patient.allergies || patient.existingConditions || patient.currentMedications) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {patient.allergies && <Alert tone="danger" title="Allergies" text={patient.allergies} />}
          {patient.existingConditions && <Alert tone="warning" title="Existing conditions" text={patient.existingConditions} />}
          {patient.currentMedications && <Alert tone="info" title="Current medications" text={patient.currentMedications} />}
        </div>
      )}

      <div className="mb-4 max-w-xl">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'overview', label: 'Overview' },
            { key: 'visits', label: `Visits (${history?.consultations.length ?? 0})` },
            { key: 'prescriptions', label: `Prescriptions (${history?.prescriptions.length ?? 0})` },
            { key: 'documents', label: `Documents (${history?.documents.length ?? 0})` },
            { key: 'family', label: 'Family' },
          ]}
        />
      </div>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card card-pad lg:col-span-2">
            <h2 className="section-title mb-3">Patient details</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Mobile" value={patient.mobile} />
              <Detail label="Email" value={patient.email} />
              <Detail label="Address" value={patient.address} />
              <Detail label="Emergency contact" value={patient.emergencyContact} />
              <Detail label="Medical history" value={patient.medicalHistory} />
              <Detail label="Registered" value={formatDate(patient.createdAt)} />
            </dl>
          </div>
          <div className="card card-pad">
            <h2 className="section-title mb-3">Latest vitals</h2>
            {!history?.vitals.length ? <p className="text-sm text-ink-500">No vitals recorded yet.</p> : (
              <ul className="space-y-2 text-sm">
                {history.vitals.slice(0, 5).map((v) => (
                  <li key={v.id} className="flex items-center justify-between border-b border-ink-100 pb-2 last:border-0">
                    <span className="text-ink-600">{formatDateTime(v.recordedAt)}</span>
                    <span className="text-right text-ink-800">
                      {v.bpSystolic && v.bpDiastolic ? `BP ${v.bpSystolic}/${v.bpDiastolic}` : ''}
                      {v.pulse ? ` · Pulse ${v.pulse}` : ''}
                      {v.temperature ? ` · ${v.temperature}°C` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === 'visits' && (
        <div className="space-y-2">
          {!history?.consultations.length && <EmptyState icon={<Stethoscope className="h-5 w-5" />} title="No visits recorded" />}
          {history?.consultations.map((c) => (
            <Link key={c.id} to={`/consultations/${c.id}`} className="card card-pad block hover:bg-ink-50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink-900">{formatDateTime(c.startedAt)}</p>
                  <p className="hint">{c.doctor?.name} · {c.diagnosis ?? c.chiefComplaint ?? 'No diagnosis recorded'}</p>
                </div>
                <StatusBadge status={c.status} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'prescriptions' && (
        <div className="space-y-2">
          {!history?.prescriptions.length && <EmptyState icon={<Pill className="h-5 w-5" />} title="No prescriptions" />}
          {history?.prescriptions.map((p) => (
            <Link key={p.id} to={`/prescriptions/${p.id}`} className="card card-pad block hover:bg-ink-50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-ink-900">{p.prescriptionNo}</p>
                  <p className="hint">{p.doctor?.name} · v{p.versions[0]?.version ?? 1} · {formatDateTime(p.issuedAt ?? p.createdAt)}</p>
                </div>
                <StatusBadge status={p.status} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {tab === 'documents' && (
        <div className="space-y-2">
          {!history?.documents.length && <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" message="Upload lab reports and scans from the Documents page." />}
          {history?.documents.map((d) => (
            <div key={d.id} className="card flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><FileText className="h-4 w-4" /></span>
                <div>
                  <p className="text-sm font-medium text-ink-900">{d.title}</p>
                  <p className="hint">{humanize(d.category)} · {formatDate(d.createdAt)}</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void downloadDocument(d.id, d.fileName)}>Download</Button>
            </div>
          ))}
        </div>
      )}

      {tab === 'family' && (
        <div className="space-y-4">
          <div className="card card-pad">
            <h2 className="section-title mb-3">Family members managed by this patient</h2>
            {!patient.asPrimary?.length ? <p className="text-sm text-ink-500">No family members linked.</p> : (
              <ul className="divide-y divide-ink-100">
                {patient.asPrimary.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-2.5">
                    <Link to={`/patients/${f.member.id}`} className="text-sm font-medium text-brand-700 hover:underline">{f.member.name}</Link>
                    <span className="hint">{humanize(f.relation)} · records {f.canViewRecords ? 'shared' : 'private'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {patient.asMember && patient.asMember.length > 0 && (
            <div className="card card-pad">
              <h2 className="section-title mb-3">Also a family member of</h2>
              <ul className="divide-y divide-ink-100">
                {patient.asMember.map((f) => (
                  <li key={f.id} className="flex items-center justify-between py-2.5">
                    <Link to={`/patients/${f.primary.id}`} className="text-sm font-medium text-brand-700 hover:underline">{f.primary.name}</Link>
                    <span className="hint">{humanize(f.relation)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="hint">A family member's medical records are only visible to another family member when sharing is explicitly enabled.</p>
        </div>
      )}

      <LinkFamilyModal open={familyOpen} onClose={() => setFamilyOpen(false)} patientId={id!} clinicId={activeClinic?.id} onDone={() => void qc.invalidateQueries({ queryKey: ['patient', id] })} />
    </div>
  );
}

async function downloadDocument(id: string, fileName: string) {
  const blob = await api.blob(`/documents/${id}/download`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value || '—'}</dd>
    </div>
  );
}

function Alert({ tone, title, text }: { tone: 'danger' | 'warning' | 'info'; title: string; text: string }) {
  const tones = {
    danger: 'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  };
  return (
    <div className={`rounded-lg border p-3 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{title}</p>
      <p className="mt-0.5 text-sm">{text}</p>
    </div>
  );
}

function LinkFamilyModal({ open, onClose, patientId, clinicId, onDone }: { open: boolean; onClose: () => void; patientId: string; clinicId?: string; onDone: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [memberId, setMemberId] = useState('');
  const [relation, setRelation] = useState('SPOUSE');
  const [canView, setCanView] = useState(false);

  const { data } = useQuery({
    queryKey: ['patients-picker-family', clinicId, search],
    queryFn: () => api.get<{ items: Patient[] }>('/patients', { clinicId, search, pageSize: 6 }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api.post(`/patients/${patientId}/family`, { memberPatientId: memberId, relation, canViewRecords: canView }),
    onSuccess: () => {
      toast.success('Family member linked');
      onDone();
      onClose();
      setMemberId(''); setSearch('');
    },
    onError: (e) => toast.error('Could not link family member', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link a family member"
      description="Family links let a patient manage relatives. Record sharing is opt-in per member."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!memberId}>Link member</Button></>}
    >
      <div className="space-y-4">
        <Field label="Find patient">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" />
        </Field>
        <div className="scroll-thin max-h-44 space-y-1 overflow-y-auto">
          {data?.items.filter((p) => p.id !== patientId).map((p) => (
            <button key={p.id} onClick={() => setMemberId(p.id)} className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${memberId === p.id ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:bg-ink-50'}`}>
              <span className="font-medium text-ink-800">{p.name}</span>
              <span className="hint">{p.patientCode}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Relation">
            <Select value={relation} onChange={(e) => setRelation(e.target.value)}>
              {['SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'OTHER'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
            </Select>
          </Field>
          <label className="flex items-end gap-2 pb-2 text-sm text-ink-700">
            <input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
            Allow this member to view the records
          </label>
        </div>
      </div>
    </Modal>
  );
}
