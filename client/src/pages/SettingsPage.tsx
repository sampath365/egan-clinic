import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pill, Plus, Save, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { humanize } from '@/lib/utils';
import { PageHeader, Tabs, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { InlineSpinner } from '@/components/ui/Spinner';
import type { Clinic, Pharmacy } from '@/types';

interface StaffRow { id: string; userId: string; fullName: string; email: string; designation?: string | null; isActive: boolean; roles: string[] }

export function SettingsPage() {
  const { activeClinic, refresh } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const clinicId = activeClinic?.id;
  const [tab, setTab] = useState('profile');

  const { data, isLoading } = useQuery({
    queryKey: ['clinic', clinicId],
    queryFn: () => api.get<{ clinic: Clinic; settings: Record<string, string> }>(`/clinics/${clinicId}`),
    enabled: Boolean(clinicId),
  });

  const { data: pharmacies } = useQuery({
    queryKey: ['pharmacies', clinicId],
    queryFn: () => api.get<{ pharmacies: Pharmacy[] }>('/pharmacies', { clinicId }),
    enabled: Boolean(clinicId) && Boolean(activeClinic?.medicalShopEnabled),
  });

  const { data: staff } = useQuery({
    queryKey: ['staff', clinicId],
    queryFn: () => api.get<{ staff: StaffRow[] }>(`/clinics/${clinicId}/staff`),
    enabled: Boolean(clinicId),
  });

  const toggleShop = useMutation({
    mutationFn: (enabled: boolean) => api.put(`/clinics/${clinicId}/settings`, { medicalShopEnabled: enabled }),
    onSuccess: (_d, enabled) => {
      void qc.invalidateQueries({ queryKey: ['clinic'] });
      void qc.invalidateQueries({ queryKey: ['pharmacies'] });
      void refresh();
      toast.success(`Medical shop ${enabled ? 'enabled' : 'disabled'}`, enabled ? 'Pharmacy options will now appear in prescriptions.' : 'Pharmacy features are hidden across the app.');
    },
    onError: (e) => toast.error('Could not update the medical shop setting', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading || !data) return <InlineSpinner label="Loading settings…" />;

  return (
    <div>
      <PageHeader title="Clinic settings" subtitle="Profile, medical shop, staff and prescription defaults" />

      <div className="mb-4 max-w-2xl">
        <Tabs value={tab} onChange={setTab} tabs={[
          { key: 'profile', label: 'Profile' },
          { key: 'shop', label: 'Medical shop' },
          { key: 'staff', label: 'Staff' },
          { key: 'prescription', label: 'Prescription' },
        ]} />
      </div>

      {tab === 'profile' && <ClinicProfileForm clinic={data.clinic} onSaved={() => { void qc.invalidateQueries({ queryKey: ['clinic'] }); void refresh(); }} />}

      {tab === 'shop' && (
        <div className="space-y-4">
          <div className="card card-pad">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Pill className="h-5 w-5" /></span>
                <div>
                  <p className="text-sm font-semibold text-ink-900">Enable medical shop</p>
                  <p className="hint max-w-lg">
                    When enabled, prescriptions can be sent to an attached medical shop and, with patient consent, to external EGAN pharmacies.
                    When disabled, all pharmacy features are hidden.
                  </p>
                </div>
              </div>
              <button
                role="switch"
                aria-checked={data.clinic.medicalShopEnabled}
                onClick={() => toggleShop.mutate(!data.clinic.medicalShopEnabled)}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-3 before:-inset-y-3 before:content-[''] ${data.clinic.medicalShopEnabled ? 'bg-brand-600' : 'bg-ink-300'}`}
              >
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${data.clinic.medicalShopEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {data.clinic.medicalShopEnabled ? (
            <PharmacySection clinicId={clinicId} pharmacies={pharmacies?.pharmacies ?? []} onChanged={() => void qc.invalidateQueries({ queryKey: ['pharmacies'] })} />
          ) : (
            <EmptyState icon={<Pill className="h-5 w-5" />} title="Medical shop is disabled" message="Enable it above to configure an attached medical shop and pharmacist accounts." />
          )}
        </div>
      )}

      {tab === 'staff' && <StaffSection staff={staff?.staff ?? []} />}

      {tab === 'prescription' && <PrescriptionSettings clinicId={clinicId} settings={data.settings} onSaved={() => void qc.invalidateQueries({ queryKey: ['clinic'] })} />}
    </div>
  );
}

function ClinicProfileForm({ clinic, onSaved }: { clinic: Clinic; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: clinic.name, address: clinic.address ?? '', phone: clinic.phone ?? '', email: clinic.email ?? '',
    registrationNo: clinic.registrationNo ?? '', licenseNo: clinic.licenseNo ?? '', emergencyContact: clinic.emergencyContact ?? '',
    website: clinic.website ?? '', whatsappNumber: clinic.whatsappNumber ?? '', consultationFee: String(clinic.consultationFee),
    currency: clinic.currency, timezone: clinic.timezone,
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch(`/clinics/${clinic.id}`, {
      ...form, consultationFee: Number(form.consultationFee) || 0,
      email: form.email || undefined,
    }),
    onSuccess: () => { toast.success('Clinic profile updated'); onSaved(); },
    onError: (e) => toast.error('Could not update profile', e instanceof ApiError ? e.message : undefined),
  });

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.post(`/clinics/${clinic.id}/logo`, form);
      toast.success('Logo uploaded', 'It will appear on prescription PDFs.');
      onSaved();
    } catch (e) {
      toast.error('Could not upload logo', e instanceof ApiError ? e.message : undefined);
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="card card-pad">
      <div className="mb-4 flex items-center gap-4 border-b border-ink-100 pb-4">
        {clinic.logoUrl ? (
          <img src={`/api/assets/clinic-logo?clinicId=${clinic.id}`} alt="Clinic logo" className="h-14 w-14 rounded-lg border border-ink-200 object-contain" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-ink-100 text-ink-400"><Building2 className="h-6 w-6" /></span>
        )}
        <div>
          <p className="text-sm font-medium text-ink-900">Clinic logo</p>
          <p className="hint">PNG, JPEG or WebP, up to 3 MB. Shown on prescriptions.</p>
          <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={uploadingLogo}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
            {uploadingLogo ? 'Uploading…' : clinic.logoUrl ? 'Replace logo' : 'Upload logo'}
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clinic name" required><Input value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Website"><Input value={form.website} onChange={(e) => set('website', e.target.value)} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label="Registration number"><Input value={form.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
        <Field label="License number"><Input value={form.licenseNo} onChange={(e) => set('licenseNo', e.target.value)} /></Field>
        <Field label="Emergency contact"><Input value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} /></Field>
        <Field label="WhatsApp number"><Input value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} /></Field>
        <Field label="Consultation fee"><Input inputMode="decimal" value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} /></Field>
        <Field label="Currency"><Input value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
        <Field label="Time zone"><Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
      </div>
      <Button className="mt-4" onClick={() => mutation.mutate()} loading={mutation.isPending}><Save className="h-4 w-4" /> Save profile</Button>
    </div>
  );
}

function PharmacySection({ clinicId, pharmacies, onChanged }: { clinicId?: string; pharmacies: Pharmacy[]; onChanged: () => void }) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [addExternalOpen, setAddExternalOpen] = useState(false);
  const [assignFor, setAssignFor] = useState<Pharmacy | null>(null);
  const attached = pharmacies.find((p) => p.type === 'ATTACHED');

  const addPharmacy = useMutation({
    mutationFn: (form: { name: string; phone: string; address: string; licenseNo: string; type: string }) =>
      api.post('/pharmacies', { clinicId, ...form, type: form.type }),
    onSuccess: () => { toast.success('Medical shop added'); onChanged(); setAddOpen(false); setAddExternalOpen(false); },
    onError: (e) => toast.error('Could not add medical shop', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="space-y-4">
      <div className="card card-pad">
        <h2 className="section-title mb-3">Attached medical shop</h2>
        {attached ? (
          <>
            <div className="space-y-1.5 text-sm">
              <p className="font-semibold text-ink-900">{attached.name}</p>
              <p className="text-ink-600">{attached.address ?? '—'}</p>
              <p className="hint">{attached.phone ?? '—'} · License {attached.licenseNo ?? '—'}</p>
            </div>
            <div className="mt-3">
              <p className="label">Pharmacists</p>
              {!attached.users?.length ? <p className="hint">No pharmacist accounts assigned yet.</p> : (
                <ul className="divide-y divide-ink-100">
                  {attached.users.map((u) => (
                    <li key={u.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-ink-800">{u.user.fullName}</span>
                      <span className="hint">{u.user.email} · {humanize(u.role)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => setAssignFor(attached)}>Assign pharmacist</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-600">No attached medical shop is configured. Add one to forward prescriptions for pharmacist review.</p>
            <Button className="mt-3" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add attached medical shop</Button>
          </>
        )}
      </div>

      <div className="card card-pad">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">External EGAN pharmacies</h2>
          <Button size="sm" variant="secondary" onClick={() => setAddExternalOpen(true)}><Plus className="h-3.5 w-3.5" /> Add pharmacy</Button>
        </div>
        <ul className="divide-y divide-ink-100">
          {pharmacies.filter((p) => p.type !== 'ATTACHED').map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <p className="font-medium text-ink-800">{p.name}</p>
                <p className="hint">{p.address ?? '—'}{p.phone ? ` · ${p.phone}` : ''}</p>
              </div>
              {p.isEganParticipating && <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">EGAN participating</span>}
            </li>
          ))}
          {pharmacies.filter((p) => p.type !== 'ATTACHED').length === 0 && <li className="py-2 text-sm text-ink-500">No external pharmacies available.</li>}
        </ul>
        <p className="hint mt-3">External pharmacies require recorded patient consent before a prescription is shared.</p>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add attached medical shop" size="md"
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button onClick={() => addPharmacy.mutate({ name: 'EGAN Medical Store', phone: '', address: '', licenseNo: '', type: 'ATTACHED' })} loading={addPharmacy.isPending}>Add medical shop</Button></>}>
        <p className="text-sm text-ink-600">
          This adds an attached medical shop named “EGAN Medical Store”. Assign a pharmacist account afterwards.
        </p>
      </Modal>

      {addExternalOpen && <ExternalPharmacyModal onClose={() => setAddExternalOpen(false)} onAdd={(f) => addPharmacy.mutate(f)} loading={addPharmacy.isPending} />}
      {assignFor && <AssignPharmacistModal pharmacy={assignFor} onClose={() => setAssignFor(null)} onDone={() => { onChanged(); setAssignFor(null); }} />}
    </div>
  );
}

function ExternalPharmacyModal({ onClose, onAdd, loading }: { onClose: () => void; onAdd: (f: { name: string; phone: string; address: string; licenseNo: string; type: string }) => void; loading: boolean }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [licenseNo, setLicenseNo] = useState('');
  const [egan, setEgan] = useState(true);

  return (
    <Modal open onClose={onClose} title="Add external pharmacy" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onAdd({ name, phone, address, licenseNo, type: egan ? 'EGAN' : 'EXTERNAL' })} loading={loading} disabled={!name.trim()}>Add pharmacy</Button></>}>
      <div className="space-y-3">
        <Field label="Pharmacy name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
        <Field label="Drug licence no."><Input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={egan} onChange={(e) => setEgan(e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
          Participating EGAN medical shop
        </label>
      </div>
    </Modal>
  );
}

function AssignPharmacistModal({ pharmacy, onClose, onDone }: { pharmacy: Pharmacy; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('PHARMACIST');

  const mutation = useMutation({
    mutationFn: () => api.post(`/pharmacies/${pharmacy.id}/users/by-email`, { email, role }),
    onSuccess: (res) => {
      toast.success('Pharmacist assigned', `${(res as { fullName?: string }).fullName ?? email} can now review prescriptions.`);
      onDone();
    },
    onError: (e) => toast.error('Could not assign pharmacist', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal open onClose={onClose} title={`Assign pharmacist — ${pharmacy.name}`} size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!email.trim()}>Assign</Button></>}>
      <div className="space-y-3">
        <Field label="User email" required hint="The person must already have an EGAN Clinic account.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pharmacist@example.com" />
        </Field>
        <Field label="Pharmacy role">
          <Select value={role} onChange={(e) => setRole(e.target.value)}>
            {['PHARMACIST', 'MANAGER', 'STAFF'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
          </Select>
        </Field>
        <p className="hint">Pharmacists only see prescriptions explicitly shared with this pharmacy.</p>
      </div>
    </Modal>
  );
}

function StaffSection({ staff }: { staff: StaffRow[] }) {
  const toast = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [designation, setDesignation] = useState('');
  const [role, setRole] = useState('RECEPTIONIST');

  const { data: users } = useQuery({
    queryKey: ['all-users'],
    queryFn: async () => {
      // The demo exposes user lookup through clinic staff only; for adding a new
      // member the owner enters the email of an existing account.
      return { users: [] as Array<{ id: string; email: string }> };
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      // Look up the user by email is not exposed publicly; the API accepts a userId.
      // Here we surface a clear message if the account cannot be resolved.
      throw new ApiError(400, 'USE_USER_ID', 'Adding staff requires the account user id. Use the API with a known userId, or invite the user to register first.');
    },
    onError: (e) => toast.error('Could not add staff', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="card card-pad">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title flex items-center gap-2"><Users className="h-4 w-4" /> Clinic staff</h2>
        <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" /> Add staff</Button>
      </div>
      {staff.length === 0 ? <p className="text-sm text-ink-500">No staff records.</p> : (
        <ul className="divide-y divide-ink-100">
          {staff.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink-900">{s.fullName}</p>
                <p className="hint">{s.email} · {s.designation ?? 'Staff'}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                {s.roles.map((r) => <span key={r} className="rounded-full bg-ink-100 px-2.5 py-0.5 text-xs font-medium text-ink-700">{humanize(r)}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add staff member" size="md"
        footer={<><Button variant="secondary" onClick={() => setAddOpen(false)}>Cancel</Button><Button onClick={() => add.mutate()} loading={add.isPending}>Add</Button></>}>
        <div className="space-y-3">
          <Field label="User email" required hint="The person must already have an EGAN Clinic account.">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@clinic.com" />
          </Field>
          <Field label="Designation"><Input value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Front desk" /></Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {['CLINIC_OWNER', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'CLINIC_STAFF', 'PHARMACIST'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
            </Select>
          </Field>
          <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Roles grant least-privilege permissions. A pharmacist does not receive clinical administration access, and a doctor does not receive pharmacy access.</span>
          </div>
          {users && users.users.length === 0 && <p className="hint">Demo tip: the seeded accounts are already members of the clinic.</p>}
        </div>
      </Modal>
    </div>
  );
}

function PrescriptionSettings({ clinicId, settings, onSaved }: { clinicId?: string; settings: Record<string, string>; onSaved: () => void }) {
  const toast = useToast();
  const [footer, setFooter] = useState(settings.prescription_footer ?? '');
  const [followUpDays, setFollowUpDays] = useState(settings.default_follow_up_days ?? '7');
  const [retention, setRetention] = useState(settings.data_retention_days ?? '');

  const mutation = useMutation({
    mutationFn: () => api.put(`/clinics/${clinicId}/settings`, {
      prescriptionFooter: footer,
      defaultFollowUpDays: Number(followUpDays) || 0,
      ...(retention ? { dataRetentionDays: Number(retention) } : {}),
    }),
    onSuccess: () => { toast.success('Prescription settings saved'); onSaved(); },
    onError: (e) => toast.error('Could not save', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <div className="card card-pad">
      <h2 className="section-title mb-3 flex items-center gap-2"><Stethoscope className="h-4 w-4" /> Prescription defaults</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Default follow-up (days)"><Input inputMode="numeric" value={followUpDays} onChange={(e) => setFollowUpDays(e.target.value)} /></Field>
        <Field label="Data retention (days)" hint="Leave blank to keep records indefinitely."><Input inputMode="numeric" value={retention} onChange={(e) => setRetention(e.target.value)} /></Field>
        <Field label="Prescription footer" className="sm:col-span-2"><Textarea rows={3} value={footer} onChange={(e) => setFooter(e.target.value)} /></Field>
      </div>
      <Button className="mt-4" onClick={() => mutation.mutate()} loading={mutation.isPending}><Save className="h-4 w-4" /> Save settings</Button>
    </div>
  );
}

