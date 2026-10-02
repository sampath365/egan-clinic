import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

interface VerifyResult {
  valid: boolean;
  prescriptionNo: string;
  clinicName: string;
  doctorName: string;
  registrationNo?: string | null;
  issuedAt?: string | null;
  version?: number;
  versionStatus?: string;
  corrected?: boolean;
}

export function VerifyPage() {
  const { prescriptionNo } = useParams<{ prescriptionNo: string }>();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<VerifyResult>(`/prescriptions/verify/${prescriptionNo}`);
        if (!cancelled) setResult(res);
      } catch {
        if (!cancelled) setError('No prescription was found for this verification code.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [prescriptionNo]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-6">
      <div className="card card-pad w-full max-w-md">
        <h1 className="text-lg font-semibold text-ink-900">Prescription verification</h1>
        <p className="mt-1 text-sm text-ink-500">Scanned from a prescription issued through EGAN Clinic.</p>

        {loading && <p className="mt-6 text-sm text-ink-500">Checking…</p>}

        {error && (
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-3">
            <div className={`flex items-center gap-2 rounded-lg p-3 text-sm font-medium ${result.valid ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-red-200 bg-red-50 text-red-700'}`}>
              {result.valid ? <BadgeCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              {result.valid ? 'This prescription is valid' : 'This prescription could not be verified'}
            </div>
            <dl className="space-y-2 text-sm">
              <Row label="Prescription No." value={result.prescriptionNo} />
              <Row label="Clinic" value={result.clinicName} />
              <Row label="Doctor" value={result.doctorName} />
              {result.registrationNo && <Row label="Registration" value={result.registrationNo} />}
              <Row label="Issued" value={formatDateTime(result.issuedAt)} />
              <Row label="Version" value={String(result.version ?? '—')} />
              {result.corrected && <Row label="Note" value="A corrected version has been issued" />}
            </dl>
            <p className="hint">For privacy, clinical details are not shown on this page.</p>
          </div>
        )}

        <Link
          to="/login"
          className="mt-6 flex h-10 w-full items-center justify-center rounded-lg border border-ink-300 bg-white text-sm font-medium text-ink-800 hover:bg-ink-50"
        >
          Go to EGAN Clinic
        </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-right font-medium text-ink-900">{value}</dd>
    </div>
  );
}
