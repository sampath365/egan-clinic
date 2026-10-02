import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { ageFromDob, formatDate } from '@/lib/utils';
import { PageHeader, EmptyState, Avatar } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Search } from '@/components/ui/Search';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Paginated, Patient } from '@/types';

export function PatientsPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const clinicId = activeClinic?.id;
  const [search, setSearch] = useState('');
  const [registering, setRegistering] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['patients', clinicId, search],
    queryFn: () => api.get<Paginated<Patient>>('/patients', { clinicId, search, pageSize: 50 }),
    enabled: Boolean(clinicId),
  });

  const columns: Column<Patient>[] = [
    {
      key: 'name', header: 'Patient',
      render: (p) => (
        <div className="flex items-center gap-3">
          <Avatar name={p.name} size={34} />
          <div>
            <p className="font-medium text-ink-900">{p.name}</p>
            <p className="hint">{p.patientCode}</p>
          </div>
        </div>
      ),
    },
    { key: 'age', header: 'Age / gender', render: (p) => <span>{ageFromDob(p.dateOfBirth)}{p.gender ? ` · ${p.gender.toLowerCase()}` : ''}</span> },
    { key: 'mobile', header: 'Mobile', render: (p) => <span>{p.mobile ?? '—'}</span> },
    { key: 'blood', header: 'Blood group', render: (p) => <span>{p.bloodGroup ?? '—'}</span> },
    { key: 'allergies', header: 'Allergies', render: (p) => <span className="text-ink-600">{p.allergies ?? 'None known'}</span> },
    { key: 'registered', header: 'Registered', render: (p) => <span className="hint">{formatDate(p.createdAt)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Register patients and manage family members"
        actions={can(PERMISSIONS.PATIENT_CREATE) && <Button onClick={() => setRegistering(true)}><UserPlus className="h-4 w-4" /> Register patient</Button>}
      />

      <div className="mb-4 max-w-md">
        <Search value={search} onChange={setSearch} placeholder="Search by name, patient ID or mobile" />
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(p) => p.id}
        loading={isLoading}
        onRowClick={(p) => navigate(`/patients/${p.id}`)}
        empty={<EmptyState icon={<Users className="h-5 w-5" />} title="No patients found" message={search ? 'Try a different search term.' : 'Register your first patient to get started.'} />}
      />

      {data && data.items.length > 0 && (
        <p className="hint mt-3">
          Showing {data.items.length} of {data.meta.total} patients. Open a patient to view their full history and documents.
        </p>
      )}

      <RegisterPatientModal
        open={registering}
        onClose={() => setRegistering(false)}
        clinicId={clinicId}
        onCreated={(id) => {
          void qc.invalidateQueries({ queryKey: ['patients'] });
          toast.success('Patient registered');
          navigate(`/patients/${id}`);
        }}
      />
    </div>
  );
}

export function RegisterPatientModal({ open, onClose, clinicId, onCreated }: { open: boolean; onClose: () => void; clinicId?: string; onCreated?: (id: string) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: '', dateOfBirth: '', gender: 'MALE', mobile: '', email: '', address: '',
    emergencyContact: '', bloodGroup: '', allergies: '', existingConditions: '', medicalHistory: '', currentMedications: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: () => api.post<{ patient: Patient }>('/patients', {
      clinicId,
      name: form.name,
      dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
      gender: form.gender || undefined,
      mobile: form.mobile || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      emergencyContact: form.emergencyContact || undefined,
      bloodGroup: form.bloodGroup || undefined,
      allergies: form.allergies || undefined,
      existingConditions: form.existingConditions || undefined,
      medicalHistory: form.medicalHistory || undefined,
      currentMedications: form.currentMedications || undefined,
    }),
    onSuccess: (res) => {
      onCreated?.(res.patient.id);
      onClose();
    },
    onError: (e) => toast.error('Could not register patient', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Register patient"
      description="Basic details are enough to begin. Clinical history can be added during consultation."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!form.name.trim()}>Register patient</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
          <Field label="Gender">
            <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
              {['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'].map((g) => <option key={g} value={g}>{g.toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Mobile"><Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Blood group">
            <Select value={form.bloodGroup} onChange={(e) => set('bloodGroup', e.target.value)}>
              <option value="">Unknown</option>
              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="Emergency contact"><Input value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} /></Field>
          <Field label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        </div>
        <Field label="Allergies" hint="e.g. Penicillin (rash)"><Input value={form.allergies} onChange={(e) => set('allergies', e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Existing conditions"><Textarea rows={2} value={form.existingConditions} onChange={(e) => set('existingConditions', e.target.value)} /></Field>
          <Field label="Medical history"><Textarea rows={2} value={form.medicalHistory} onChange={(e) => set('medicalHistory', e.target.value)} /></Field>
          <Field label="Current medications"><Textarea rows={2} value={form.currentMedications} onChange={(e) => set('currentMedications', e.target.value)} /></Field>
        </div>
      </div>
    </Modal>
  );
}
