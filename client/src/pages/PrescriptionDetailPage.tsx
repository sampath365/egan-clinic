import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Building2, Download, FileText, History, PencilLine, Share2, ShieldCheck, XCircle,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import { PageHeader, Tabs, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Pharmacy, Prescription, PrescriptionVersion } from '@/types';

export function PrescriptionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();

  const { can } = usePermissions();
  const [tab, setTab] = useState('current');
  const [shareOpen, setShareOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['prescription', id],
    queryFn: () => api.get<{ prescription: Prescription }>(`/prescriptions/${id}`),
    enabled: Boolean(id),
  });

  const { data: audit } = useQuery({
    queryKey: ['prescription-audit', id],
    queryFn: () => api.get<{ items: Array<{ id: string; action: string; actorName?: string | null; createdAt: string }> }>(`/audit/entity/Prescription/${id}`),
    enabled: Boolean(id),
  });

  const rx = data?.prescription;

  const correct = useMutation({
    mutationFn: () => api.post<{ prescription: Prescription }>(`/prescriptions/${id}/correct`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescription', id] });
      toast.success('Corrected version created', 'Edit the new draft and sign to issue it.');
      navigate(`/prescriptions/${id}/edit`);
    },
    onError: (e) => toast.error('Could not create corrected version', e instanceof ApiError ? e.message : undefined),
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cancel = useMutation({
    mutationFn: () => api.post(`/prescriptions/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescription', id] });
      toast.success('Prescription cancelled');
    },
    onError: (e) => toast.error('Could not cancel', e instanceof ApiError ? e.message : undefined),
  });

  const whatsapp = useMutation({
    mutationFn: () => api.post<{ fallbackUrl: string; providerConfigured: boolean; message: string }>(`/prescriptions/${id}/whatsapp`),
    onSuccess: (res) => {
      if (res.providerConfigured) {
        toast.success('Shared via WhatsApp', 'Sent through the configured business messaging provider.');
      } else {
        // No business API configured: open the device share sheet as a fallback.
        window.open(res.fallbackUrl, '_blank', 'noopener');
        toast.info('Opening WhatsApp', 'A secure link is shared instead of clinical details.');
      }
      void qc.invalidateQueries({ queryKey: ['prescription', id] });
    },
    onError: (e) => toast.error('Could not share on WhatsApp', e instanceof ApiError ? e.message : undefined),
  });

  async function downloadPdf() {
    try {
      const blob = await api.blob(`/prescriptions/${id}/pdf`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rx?.prescriptionNo ?? 'prescription'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not generate the PDF');
    }
  }

  if (isLoading || !rx) return <InlineSpinner label="Loading prescription…" />;

  const versions = [...rx.versions].sort((a, b) => b.version - a.version);
  const current = versions.find((v) => v.status === 'ISSUED') ?? versions[0];
  const isIssued = ['ISSUED', 'SHARED', 'VIEWED', 'CORRECTED'].includes(rx.status);

  return (
    <div>
      <button onClick={() => navigate('/prescriptions')} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> All prescriptions
      </button>

      <PageHeader
        title={rx.prescriptionNo}
        subtitle={`${rx.patient?.name} · ${rx.patient?.patientCode} · Dr. ${rx.doctor?.name}`}
        actions={
          <>
            <StatusBadge status={rx.status} />
            <Button variant="outline" onClick={downloadPdf}><Download className="h-4 w-4" /> PDF</Button>
            {can(PERMISSIONS.PRESCRIPTION_SHARE) && isIssued && (
              <Button variant="secondary" onClick={() => whatsapp.mutate()} loading={whatsapp.isPending}><Share2 className="h-4 w-4" /> WhatsApp</Button>
            )}
            {can(PERMISSIONS.PRESCRIPTION_SHARE) && isIssued && (
              <Button onClick={() => setShareOpen(true)}><Share2 className="h-4 w-4" /> Send prescription</Button>
            )}
            {can(PERMISSIONS.PRESCRIPTION_CREATE) && (rx.status === 'DRAFT' || rx.status === 'REVIEW') && (
              <Link to={`/prescriptions/${id}/edit`} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                <PencilLine className="h-4 w-4" /> Continue editing
              </Link>
            )}
            {can(PERMISSIONS.PRESCRIPTION_CORRECT) && isIssued && rx.status !== 'CANCELLED' && (
              <Button variant="secondary" onClick={() => setCorrecting(true)}><History className="h-4 w-4" /> Create corrected version</Button>
            )}
            {can(PERMISSIONS.PRESCRIPTION_CORRECT) && rx.status !== 'CANCELLED' && (
              <Button variant="ghost" onClick={() => cancel.mutate()} loading={cancel.isPending}><XCircle className="h-4 w-4" /> Cancel</Button>
            )}
          </>
        }
      />

      <div className="mb-4 max-w-lg">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'current', label: 'Current version' },
            { key: 'history', label: `Version history (${versions.length})` },
            { key: 'shares', label: `Shared with (${rx.shares?.length ?? 0})` },
            { key: 'audit', label: 'Audit trail' },
          ]}
        />
      </div>

      {tab === 'current' && current && <VersionView version={current} rx={rx} />}

      {tab === 'history' && (
        <div className="space-y-2">
          {versions.map((v) => (
            <div key={v.id} className="card card-pad">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Version {v.version}</p>
                  <p className="hint">
                    {v.issuedAt ? `Issued ${formatDateTime(v.issuedAt)}` : 'Draft — not yet issued'}
                    {v.supersededByVersion ? ` · superseded by v${v.supersededByVersion}` : ''}
                  </p>
                  {v.contentHash && <p className="hint font-mono">hash {v.contentHash.slice(0, 16)}…</p>}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={v.status} />
                  <Button size="sm" variant="ghost" onClick={() => void api.blob(`/prescriptions/${id}/pdf`, { version: v.version }).then((b) => {
                    const url = URL.createObjectURL(b);
                    const a = document.createElement('a'); a.href = url; a.download = `${rx.prescriptionNo}-v${v.version}.pdf`; a.click(); URL.revokeObjectURL(url);
                  })}><Download className="h-3.5 w-3.5" /> PDF</Button>
                </div>
              </div>
              {v.medicines.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-ink-700">
                  {v.medicines.map((m, i) => <li key={i}>{i + 1}. {m.name} {m.strength} — {[m.dose, m.frequency, m.duration].filter(Boolean).join(', ')}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'shares' && (
        <div>
          {!rx.shares?.length ? <EmptyState icon={<Share2 className="h-5 w-5" />} title="Not shared yet" message="Use Send prescription to deliver it to the patient or a medical shop." /> : (
            <ul className="card divide-y divide-ink-100">
              {rx.shares.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-600">
                      {s.targetType === 'PATIENT' ? <FileText className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-ink-900">
                        {s.targetType === 'PATIENT' ? 'Patient' : s.pharmacy?.name ?? humanize(s.targetType)}
                      </p>
                      <p className="hint">{humanize(s.channel)} · {formatDateTime(s.createdAt)}{s.viewedAt ? ` · viewed ${formatDateTime(s.viewedAt)}` : ''}</p>
                    </div>
                  </div>
                  <StatusBadge status={s.viewedAt ? 'VIEWED' : 'SHARED'} label={s.viewedAt ? 'Viewed' : 'Sent'} />
                </li>
              ))}
            </ul>
          )}
          {rx.pharmacyPrescriptions && rx.pharmacyPrescriptions.length > 0 && (
            <div className="mt-4">
              <h3 className="section-title mb-2">Pharmacy status</h3>
              <ul className="card divide-y divide-ink-100">
                {rx.pharmacyPrescriptions.map((pp) => (
                  <li key={pp.id} className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-ink-800">{pp.pharmacy.name}</span>
                    <StatusBadge status={pp.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card card-pad">
          <h2 className="section-title mb-3 flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Audit trail</h2>
          {!audit?.items.length ? <p className="text-sm text-ink-500">No audit entries yet.</p> : (
            <ol className="relative space-y-4 border-l border-ink-200 pl-5">
              {audit.items.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <p className="text-sm font-medium text-ink-900">{humanize(a.action)}</p>
                  <p className="hint">{a.actorName ?? 'System'} · {formatDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} prescriptionId={id!} onDone={() => void qc.invalidateQueries({ queryKey: ['prescription', id] })} />

      <Modal
        open={correcting}
        onClose={() => setCorrecting(false)}
        title="Create a corrected version"
        description="The issued version is preserved exactly as it was. A new draft version is created for you to edit and sign."
        size="sm"
        footer={<><Button variant="secondary" onClick={() => setCorrecting(false)}>Cancel</Button><Button onClick={() => correct.mutate()} loading={correct.isPending}>Create corrected version</Button></>}
      >
        <p className="text-sm text-ink-700">Version {current?.version} will be marked superseded. The original stays in the audit history.</p>
      </Modal>
    </div>
  );
}

function VersionView({ version, rx }: { version: PrescriptionVersion; rx: Prescription }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-2">
        <div className="flex items-center justify-between border-b border-ink-200 pb-3">
          <div>
            <p className="text-base font-semibold text-ink-900">{rx.clinic?.name}</p>
            <p className="hint">{rx.clinic?.address} · {rx.clinic?.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-brand-700">{rx.prescriptionNo}</p>
            <p className="hint">Version {version.version}</p>
            {version.issuedAt && <p className="hint">{formatDateTime(version.issuedAt)}</p>}
          </div>
        </div>

        <div className="grid gap-3 border-b border-ink-200 py-3 sm:grid-cols-2">
          <div>
            <p className="hint">Patient</p>
            <p className="text-sm font-semibold text-ink-900">{rx.patient?.name}</p>
            <p className="hint">{rx.patient?.patientCode}{rx.patient?.allergies ? ` · Allergies: ${rx.patient.allergies}` : ''}</p>
          </div>
          <div>
            <p className="hint">Doctor</p>
            <p className="text-sm font-semibold text-ink-900">Dr. {rx.doctor?.name}</p>
            <p className="hint">{rx.doctor?.qualification}{rx.doctor?.registrationNo ? ` · Reg ${rx.doctor.registrationNo}` : ''}</p>
          </div>
        </div>

        {version.diagnosis && <p className="mt-3 text-sm"><span className="font-semibold">Diagnosis: </span>{version.diagnosis}</p>}

        <div className="mt-4">
          <p className="section-title mb-2">Medicines</p>
          {version.medicines.length === 0 ? (
            <p className="text-sm text-ink-500">No structured medicines on this version.</p>
          ) : (
            <ol className="space-y-2">
              {version.medicines.map((m, i) => (
                <li key={i} className="rounded-lg bg-ink-50 p-3 text-sm">
                  <p className="font-semibold text-ink-900">{i + 1}. {m.name} {m.strength} {m.form ? `(${m.form.toLowerCase()})` : ''}</p>
                  <p className="hint mt-0.5">{[m.dose, m.frequency, m.route, m.duration, m.foodRelation && m.foodRelation !== 'NA' ? humanize(m.foodRelation) : null, m.quantity ? `Qty ${m.quantity}` : null].filter(Boolean).join(' · ')}</p>
                  {m.instructions && <p className="hint">{m.instructions}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>

        {version.notesList.length > 0 && (
          <div className="mt-4">
            <p className="section-title mb-2">Investigations & notes</p>
            <ul className="space-y-1 text-sm text-ink-700">
              {version.notesList.map((n) => <li key={n.id}>• {n.text} <span className="hint">({humanize(n.type)})</span></li>)}
            </ul>
          </div>
        )}

        {version.advice && <p className="mt-4 text-sm"><span className="font-semibold">Advice: </span>{version.advice}</p>}
        {version.notes && <p className="mt-2 text-sm text-ink-600"><span className="font-semibold">Notes: </span>{version.notes}</p>}
        {version.followUpDate && <p className="mt-2 text-sm"><span className="font-semibold">Follow-up: </span>{formatDateTime(version.followUpDate)}</p>}

        {version.voiceTranscript && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Voice transcript (reviewed by the doctor)</p>
            <p className="mt-0.5">{version.voiceTranscript}</p>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {version.inkStrokesJson && (
          <div className="card card-pad">
            <p className="section-title mb-2">Handwritten layer</p>
            <InkPreview strokesJson={version.inkStrokesJson} />
            <p className="hint mt-2">Preserved exactly as written. Not converted into medicine orders.</p>
          </div>
        )}
        <div className="card card-pad">
          <p className="section-title mb-2">Signature</p>
          <div className="border-b border-ink-200 pb-2">
            <p className="text-sm font-semibold text-ink-900">Dr. {rx.doctor?.name}</p>
            <p className="hint">{version.issuedAt ? 'Digitally signed on issue' : 'Not yet signed'}</p>
          </div>
          {version.contentHash && <p className="hint mt-2 font-mono text-[11px] break-all">{version.contentHash}</p>}
        </div>
      </div>
    </div>
  );
}

function InkPreview({ strokesJson }: { strokesJson: string }) {
  let strokes: Array<{ points: Array<{ x: number; y: number }>; color: string; width: number; tool: string }> = [];
  try { strokes = JSON.parse(strokesJson); } catch { strokes = []; }
  const points = strokes.flatMap((s) => s.points);
  if (points.length === 0) return <p className="text-sm text-ink-500">No strokes recorded.</p>;
  const maxX = Math.max(...points.map((p) => p.x), 100);
  const maxY = Math.max(...points.map((p) => p.y), 100);
  return (
    <svg viewBox={`0 0 ${maxX + 20} ${maxY + 20}`} className="w-full rounded-lg border border-ink-200 bg-white" role="img" aria-label="Handwritten prescription">
      {strokes.map((s, i) => (
        <polyline
          key={i}
          fill="none"
          stroke={s.tool === 'eraser' ? '#ffffff' : s.color}
          strokeWidth={s.tool === 'eraser' ? s.width * 3 : s.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={s.points.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      ))}
    </svg>
  );
}

function ShareModal({ open, onClose, prescriptionId, onDone }: { open: boolean; onClose: () => void; prescriptionId: string; onDone: () => void }) {
  const toast = useToast();
  const { activeClinic } = useAuth();

  const [toPatient, setToPatient] = useState(true);
  const [toAttached, setToAttached] = useState(false);
  const [toExternal, setToExternal] = useState(false);
  const [externalPharmacyId, setExternalPharmacyId] = useState('');
  const [consent, setConsent] = useState(false);

  const medicalShopEnabled = Boolean(activeClinic?.medicalShopEnabled);

  const { data: pharmacies } = useQuery({
    queryKey: ['eligible-pharmacies'],
    queryFn: () => api.get<{ pharmacies: Pharmacy[] }>('/pharmacies', { eligible: true }),
    enabled: open && toExternal,
  });

  const mutation = useMutation({
    mutationFn: () => {
      const targets: string[] = [];
      if (toPatient) targets.push('PATIENT');
      if (medicalShopEnabled && toAttached) targets.push('ATTACHED_PHARMACY');
      if (medicalShopEnabled && toExternal) targets.push('EXTERNAL_PHARMACY');
      return api.post<{ results: Array<{ target: string; ok: boolean; reason?: string }> }>(`/prescriptions/${prescriptionId}/share`, {
        targets, pharmacyId: externalPharmacyId || undefined, channel: 'IN_APP', patientConsent: consent,
      });
    },
    onSuccess: (res) => {
      const ok = res.results.filter((r) => r.ok);
      const failed = res.results.filter((r) => !r.ok);
      if (ok.length) toast.success('Prescription sent', `Delivered to: ${ok.map((r) => humanize(r.target)).join(', ')}`);
      for (const f of failed) toast.warning('Not delivered', `${humanize(f.target)}: ${f.reason}`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error('Could not share prescription', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send prescription"
      description="Choose who should receive this issued prescription."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!toPatient && !toAttached && !toExternal}>Send</Button></>}
    >
      <div className="space-y-3">
        <CheckOption checked={toPatient} onChange={setToPatient} title="Patient" description="Sends an in-app notification with a secure view and PDF." />

        {medicalShopEnabled ? (
          <>
            <CheckOption checked={toAttached} onChange={setToAttached} title="Attached medical shop" description="EGAN Medical Store will receive a review request. It must verify before dispensing." />
            <CheckOption checked={toExternal} onChange={setToExternal} title="External EGAN medical shop" description="Share with a participating pharmacy. Patient consent is required." />
            {toExternal && (
              <div className="ml-6 space-y-3 rounded-lg border border-ink-200 p-3">
                <div>
                  <label className="label">Select pharmacy</label>
                  <select value={externalPharmacyId} onChange={(e) => setExternalPharmacyId(e.target.value)} className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm">
                    <option value="">Choose a pharmacy…</option>
                    {pharmacies?.pharmacies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <label className="flex items-start gap-2 text-sm text-ink-700">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
                  Patient has authorised sharing with this external pharmacy.
                </label>
              </div>
            )}
          </>
        ) : (
          <p className="rounded-lg border border-ink-200 bg-ink-50 p-3 text-sm text-ink-600">
            The medical shop module is disabled for this clinic. Only the patient option is available.
          </p>
        )}

        <p className="hint">Clinical details are shared as a secure link/PDF rather than in plain message text.</p>
      </div>
    </Modal>
  );
}

function CheckOption({ checked, onChange, title, description }: { checked: boolean; onChange: (v: boolean) => void; title: string; description: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-ink-200 p-3 hover:bg-ink-50">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-ink-300" />
      <div>
        <p className="text-sm font-medium text-ink-900">{title}</p>
        <p className="hint">{description}</p>
      </div>
    </label>
  );
}

