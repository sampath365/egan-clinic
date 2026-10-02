import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Building2, HeartPulse, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError, tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

type Mode = 'patient' | 'clinic';

/**
 * Public registration. A new visitor can either:
 *  - create a patient account, then link it to an existing patient record, or
 *  - register a clinic, which makes them the CLINIC_OWNER and lands them on the
 *    dashboard immediately.
 */
export function RegisterPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('patient');

  if (!loading && user) return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-ink-50 py-10">
      <div className="mx-auto w-full max-w-2xl px-4">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <HeartPulse className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold text-ink-900">EGAN Clinic</p>
            <p className="text-sm text-ink-500">Create your account</p>
          </div>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg bg-ink-100 p-1">
          <button
            onClick={() => setMode('patient')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${mode === 'patient' ? 'bg-white text-brand-700 shadow-card' : 'text-ink-600'}`}
          >
            <UserPlus className="h-4 w-4" /> I am a patient
          </button>
          <button
            onClick={() => setMode('clinic')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${mode === 'clinic' ? 'bg-white text-brand-700 shadow-card' : 'text-ink-600'}`}
          >
            <Building2 className="h-4 w-4" /> I run a clinic
          </button>
        </div>

        {mode === 'patient'
          ? <PatientRegistration onDone={() => navigate('/', { replace: true })} onError={(m) => toast.error('Could not create account', m)} />
          : <ClinicRegistration onDone={() => navigate('/', { replace: true })} onError={(m) => toast.error('Could not register clinic', m)} />}

        <p className="mt-6 text-center text-sm text-ink-500">
          Already have an account? <Link to="/login" className="font-medium text-brand-700 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function PatientRegistration({ onDone, onError }: { onDone: () => void; onError: (m?: string) => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '', dateOfBirth: '', gender: 'MALE' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ token: string }>('/auth/register', {
        email: form.email, password: form.password, fullName: form.fullName, phone: form.phone || undefined,
      });
      tokenStore.set(res.token);

      // Link the new account to an existing patient record at a clinic, or
      // create a patient record if the person is new to the clinic.
      const clinics = await api.get<{ clinics: Array<{ id: string; name: string }> }>('/clinics');
      const clinicId = clinics.clinics[0]?.id;
      if (clinicId) {
        const match = await api.get<{ items: Array<{ id: string }> }>('/patients', { clinicId, search: form.email, pageSize: 1 });
        if (match.items[0]) {
          // The clinic already has a record for this person; the clinic must link it.
          toast.info('Account created', 'Your clinic will link this account to your patient record.');
        } else {
          await api.post('/patients', {
            clinicId, userId: undefined, name: form.fullName, email: form.email, phone: form.phone || undefined,
            dateOfBirth: form.dateOfBirth ? new Date(form.dateOfBirth).toISOString() : undefined,
            gender: form.gender,
          }).catch(() => undefined);
        }
      }
      await refresh();
      toast.success('Welcome to EGAN Clinic');
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Patient sign-up</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required /></Field>
        <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        <Field label="Password" required hint="At least 8 characters">
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} minLength={8} required />
        </Field>
        <Field label="Mobile"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Date of birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
      </div>
      <p className="hint">Your clinic links this account to your medical record. Medical information is only visible to you and your care team.</p>
      <Button type="submit" size="lg" className="w-full" loading={busy}>Create patient account</Button>
    </form>
  );
}

function ClinicRegistration({ onDone, onError }: { onDone: () => void; onError: (m?: string) => void }) {
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    clinicName: '', fullName: '', email: '', password: '', phone: '',
    address: '', consultationFee: '500', currency: 'INR', timezone: 'Asia/Kolkata',
    registrationNo: '', emergencyContact: '', website: '', whatsappNumber: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ token: string }>('/auth/register', {
        email: form.email, password: form.password, fullName: form.fullName, phone: form.phone || undefined,
      });
      tokenStore.set(res.token);

      await api.post('/clinics', {
        name: form.clinicName,
        address: form.address || undefined,
        phone: form.phone || undefined,
        email: form.email,
        registrationNo: form.registrationNo || undefined,
        emergencyContact: form.emergencyContact || undefined,
        website: form.website || undefined,
        whatsappNumber: form.whatsappNumber || undefined,
        consultationFee: Number(form.consultationFee) || 0,
        currency: form.currency,
        timezone: form.timezone,
      });

      await refresh();
      toast.success('Clinic registered', 'Your dashboard is ready.');
      onDone();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card card-pad space-y-4">
      <h1 className="text-lg font-semibold text-ink-900">Register your clinic</h1>
      <p className="hint">You will be set up as the clinic owner and can add doctors and staff afterwards.</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clinic name" required><Input value={form.clinicName} onChange={(e) => set('clinicName', e.target.value)} required /></Field>
        <Field label="Your name" required><Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} required /></Field>
        <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required /></Field>
        <Field label="Password" required hint="At least 8 characters">
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} minLength={8} required />
        </Field>
        <Field label="Clinic phone"><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="WhatsApp number"><Input value={form.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} /></Field>
        <Field label="Registration / licence no."><Input value={form.registrationNo} onChange={(e) => set('registrationNo', e.target.value)} /></Field>
        <Field label="Emergency contact"><Input value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} /></Field>
        <Field label="Consultation fee"><Input inputMode="decimal" value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} /></Field>
        <Field label="Currency"><Input value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
        <Field label="Time zone"><Input value={form.timezone} onChange={(e) => set('timezone', e.target.value)} /></Field>
        <Field label="Website"><Input value={form.website} onChange={(e) => set('website', e.target.value)} /></Field>
      </div>
      <Field label="Address"><Textarea rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>

      <Button type="submit" size="lg" className="w-full" loading={busy}>Register clinic</Button>
    </form>
  );
}
