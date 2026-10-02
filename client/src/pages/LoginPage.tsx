import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { HeartPulse, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';

const DEMO_ACCOUNTS = [
  { email: 'owner@eganclinic.demo', label: 'Clinic owner + Doctor', note: 'Dr. Aisha Rahman' },
  { email: 'dr.kapoor@eganclinic.demo', label: 'General physician', note: 'Dr. Rohit Kapoor' },
  { email: 'reception@eganclinic.demo', label: 'Receptionist', note: 'Sunita Verma' },
  { email: 'nurse@eganclinic.demo', label: 'Nurse', note: 'Anjali Nair' },
  { email: 'pharmacist@eganclinic.demo', label: 'Pharmacist', note: 'Vikram Singh' },
  { email: 'patient@eganclinic.demo', label: 'Patient', note: 'Arjun Mehta' },
];

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('owner@eganclinic.demo');
  const [password, setPassword] = useState('Password123!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between bg-brand-700 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15">
            <HeartPulse className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">EGAN Clinic</p>
            <p className="text-sm text-brand-100">Small clinic management, done simply</p>
          </div>
        </div>
        <div className="max-w-md space-y-5">
          <h1 className="text-3xl font-semibold leading-tight">Everything a small clinic needs, nothing it doesn't.</h1>
          <ul className="space-y-3 text-sm text-brand-50">
            {[
              'Appointments, walk-ins and a live token queue',
              'Consultations with vitals and clinical notes',
              'Typed, handwritten and voice prescriptions',
              'Optional attached medical shop workflow',
              'Billing, follow-ups and patient notifications',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-200" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-brand-200">
          Medical records are protected by role-based access control and a full audit trail.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-white p-6 sm:p-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white">
              <HeartPulse className="h-5 w-5" />
            </span>
            <p className="text-lg font-semibold text-ink-900">EGAN Clinic</p>
          </div>

          <h2 className="text-2xl font-semibold text-ink-900">Sign in</h2>
          <p className="mt-1 text-sm text-ink-500">Welcome back. Enter your clinic credentials to continue.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field label="Email" required>
              <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password" required>
              <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </Field>
            {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Sign in</Button>
          </form>

          <p className="mt-4 text-center text-sm text-ink-500">
            New to EGAN Clinic? <Link to="/register" className="font-medium text-brand-700 hover:underline">Create an account</Link>
          </p>

          <div className="mt-8">
            <p className="section-title">Demo accounts</p>
            <p className="hint mt-1">Password for every demo account: <code className="rounded bg-ink-100 px-1 py-0.5">Password123!</code></p>
            <div className="mt-3 grid gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => { setEmail(a.email); setPassword('Password123!'); }}
                  className="flex items-center justify-between rounded-lg border border-ink-200 px-3 py-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50/50"
                >
                  <span className="font-medium text-ink-800">{a.label}</span>
                  <span className="text-xs text-ink-500">{a.note}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
