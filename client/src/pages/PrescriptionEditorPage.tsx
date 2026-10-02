import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, CheckCircle2, Eye, Mic, PenLine, Plus, Save, Send, Trash2, Type as TypeIcon,
} from 'lucide-react';

import { api, ApiError } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import { PageHeader, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { InkCanvas, type InkCanvasHandle } from '@/components/ui/InkCanvas';
import { VoiceInput } from '@/components/ui/VoiceInput';
import { Modal } from '@/components/ui/Modal';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { Prescription, PrescriptionMedicine } from '@/types';

const EMPTY_MED: PrescriptionMedicine = { name: '', strength: '', form: 'TABLET', dose: '', frequency: '', route: 'ORAL', duration: '', instructions: '', foodRelation: 'AFTER_FOOD', quantity: '' };

export function PrescriptionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const inkRef = useRef<InkCanvasHandle>(null);
  const [tab, setTab] = useState('type');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmIssue, setConfirmIssue] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['prescription', id],
    queryFn: () => api.get<{ prescription: Prescription }>(`/prescriptions/${id}`),
    enabled: Boolean(id),
  });

  const rx = data?.prescription;
  const editableVersion = useMemo(
    () => rx?.versions.find((v) => v.status === 'DRAFT' || v.status === 'REVIEW') ?? null,
    [rx],
  );

  const [diagnosis, setDiagnosis] = useState('');
  const [advice, setAdvice] = useState('');
  const [notes, setNotes] = useState('');
  const [voice, setVoice] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [medicines, setMedicines] = useState<PrescriptionMedicine[]>([]);
  const [attachments, setAttachments] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [initialised, setInitialised] = useState(false);

  const { data: patientDocs } = useQuery({
    queryKey: ['patient-docs-for-rx', rx?.patientId],
    queryFn: () => api.get<{ documents: Array<{ id: string; title: string; category: string; createdAt: string }> }>('/documents', { patientId: rx!.patientId }),
    enabled: Boolean(rx?.patientId),
  });

  // Hydrate the form once the prescription loads.
  if (rx && !initialised) {
    const v = editableVersion;
    setDiagnosis(v?.diagnosis ?? rx.versions[0]?.diagnosis ?? '');
    setAdvice(v?.advice ?? '');
    setNotes(v?.notes ?? '');
    setVoice(v?.voiceTranscript ?? '');
    setFollowUpDate(v?.followUpDate ? v.followUpDate.slice(0, 10) : '');
    setMedicines(v?.medicines?.length ? v.medicines.map((m) => ({ ...m })) : []);
    setAttachments(
      (v?.attachments ?? []).map((a) => ({ id: a.medicalDocument.id, title: a.medicalDocument.title, category: a.medicalDocument.category })),
    );
    setInitialised(true);
  }

  const saveMutation = useMutation({
    mutationFn: (opts: { ink?: boolean; status?: 'DRAFT' | 'REVIEW' } = {}) => {
      const payload: Record<string, unknown> = {
        diagnosis: diagnosis || null,
        advice: advice || null,
        notes: notes || null,
        voiceTranscript: voice || null,
        followUpDate: followUpDate ? new Date(followUpDate).toISOString() : null,
        medicines: medicines.filter((m) => m.name.trim()).map((m, i) => ({ ...m, sortOrder: i })),
        attachmentDocumentIds: attachments.map((a) => a.id),
        status: opts.status,
      };
      return api.put(`/prescriptions/${id}/content`, payload);
    },
    onError: (e) => toast.error('Could not save draft', e instanceof ApiError ? e.message : undefined),
  });

  const saveInkMutation = useMutation({
    mutationFn: () => {
      const canvas = inkRef.current;
      if (!canvas) throw new ApiError(400, 'NO_CANVAS', 'The ink canvas is not ready');
      if (canvas.isEmpty()) throw new ApiError(400, 'EMPTY', 'Write or draw something first');
      return api.post(`/prescriptions/${id}/ink`, {
        imageBase64: canvas.toDataURL() ?? '',
        strokesJson: JSON.stringify(canvas.getStrokes()),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['prescription', id] });
      toast.success('Handwriting saved', 'Stored exactly as written — it is never converted into medicine orders.');
    },
    onError: (e) => toast.error('Could not save handwriting', e instanceof ApiError ? e.message : undefined),
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      await saveMutation.mutateAsync({});
      return api.post<{ prescription: Prescription }>(`/prescriptions/${id}/issue`);
    },
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['prescription', id] });
      void qc.invalidateQueries({ queryKey: ['prescriptions'] });
      toast.success('Prescription issued', 'A versioned, audited record has been created.');
      setConfirmIssue(false);
      navigate(`/prescriptions/${res.prescription.id}`);
    },
    onError: (e) => toast.error('Could not issue prescription', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading || !rx) return <InlineSpinner label="Loading prescription…" />;

  if (!editableVersion) {
    return (
      <div>
        <button onClick={() => navigate(`/prescriptions/${id}`)} className="mb-3 -my-1 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 sm:my-0 sm:py-0">
          <ArrowLeft className="h-4 w-4" /> Back to prescription
        </button>
        <div className="card card-pad">
          <h2 className="text-base font-semibold text-ink-900">This prescription is no longer editable</h2>
          <p className="mt-1 text-sm text-ink-500">
            Version {rx.versions[0]?.version} is {humanize(rx.versions[0]?.status)}. Issued prescriptions are immutable — create a corrected version from the prescription page if a change is required.
          </p>
          <Button className="mt-4" onClick={() => navigate(`/prescriptions/${id}`)}>View prescription</Button>
        </div>
      </div>
    );
  }

  const addMedicine = () => setMedicines((m) => [...m, { ...EMPTY_MED }]);
  const updateMedicine = (i: number, patch: Partial<PrescriptionMedicine>) =>
    setMedicines((m) => m.map((med, idx) => (idx === i ? { ...med, ...patch } : med)));
  const removeMedicine = (i: number) => setMedicines((m) => m.filter((_, idx) => idx !== i));

  return (
    <div className="pb-24">
      <button onClick={() => navigate(`/prescriptions/${id}`)} className="mb-3 -my-1 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 sm:my-0 sm:py-0">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <PageHeader
        title={`Prescription ${rx.prescriptionNo}`}
        subtitle={`${rx.patient?.name} · ${rx.patient?.patientCode} · Dr. ${rx.doctor?.name}`}
        actions={<StatusBadge status={rx.status} label={`Draft v${editableVersion.version}`} tone="info" />}
      />

      <div className="mb-4 max-w-xl">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { key: 'type', label: <><TypeIcon className="h-4 w-4" /> Type</> },
            { key: 'write', label: <><PenLine className="h-4 w-4" /> Write</> },
            { key: 'voice', label: <><Mic className="h-4 w-4" /> Voice</> },
          ]}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {tab === 'type' && (
            <div className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="section-title">Medicines</h2>
                <Button size="sm" variant="secondary" onClick={addMedicine}><Plus className="h-3.5 w-3.5" /> Add medicine</Button>
              </div>

              {medicines.length === 0 && (
                <p className="rounded-lg border border-dashed border-ink-300 bg-ink-50/50 p-4 text-sm text-ink-500">
                  No medicines added. Add one, or switch to the Write tab for a handwritten prescription.
                  Medicines are never suggested automatically — the doctor selects every item.
                </p>
              )}

              <div className="space-y-3">
                {medicines.map((m, i) => (
                  <div key={i} className="rounded-lg border border-ink-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Medicine {i + 1}</span>
                      <Button size="sm" variant="ghost" onClick={() => removeMedicine(i)} aria-label="Remove medicine"><Trash2 className="h-3.5 w-3.5 text-ink-400" /></Button>
                    </div>
                    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Medicine name" required><Input value={m.name} onChange={(e) => updateMedicine(i, { name: e.target.value })} placeholder="e.g. Paracetamol" /></Field>
                      <Field label="Generic name"><Input value={m.genericName ?? ''} onChange={(e) => updateMedicine(i, { genericName: e.target.value })} /></Field>
                      <Field label="Strength"><Input value={m.strength ?? ''} onChange={(e) => updateMedicine(i, { strength: e.target.value })} placeholder="500 mg" /></Field>
                      <Field label="Form">
                        <Select value={m.form ?? 'TABLET'} onChange={(e) => updateMedicine(i, { form: e.target.value })}>
                          {['TABLET', 'CAPSULE', 'SYRUP', 'SUSPENSION', 'INJECTION', 'CREAM', 'OINTMENT', 'DROPS', 'INHALER', 'POWDER', 'OTHER'].map((f) => <option key={f} value={f}>{humanize(f)}</option>)}
                        </Select>
                      </Field>
                      <Field label="Dose"><Input value={m.dose ?? ''} onChange={(e) => updateMedicine(i, { dose: e.target.value })} placeholder="1 tablet" /></Field>
                      <Field label="Frequency"><Input value={m.frequency ?? ''} onChange={(e) => updateMedicine(i, { frequency: e.target.value })} placeholder="Twice daily" /></Field>
                      <Field label="Route">
                        <Select value={m.route ?? 'ORAL'} onChange={(e) => updateMedicine(i, { route: e.target.value })}>
                          {['ORAL', 'TOPICAL', 'IV', 'IM', 'SC', 'INHALATION', 'NASAL', 'OCULAR', 'OTIC', 'RECTAL', 'OTHER'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
                        </Select>
                      </Field>
                      <Field label="Duration"><Input value={m.duration ?? ''} onChange={(e) => updateMedicine(i, { duration: e.target.value })} placeholder="3 days" /></Field>
                      <Field label="Food relation">
                        <Select value={m.foodRelation ?? 'AFTER_FOOD'} onChange={(e) => updateMedicine(i, { foodRelation: e.target.value })}>
                          {['BEFORE_FOOD', 'AFTER_FOOD', 'WITH_FOOD', 'EMPTY_STOMACH', 'NA'].map((f) => <option key={f} value={f}>{humanize(f)}</option>)}
                        </Select>
                      </Field>
                      <Field label="Quantity"><Input value={m.quantity ?? ''} onChange={(e) => updateMedicine(i, { quantity: e.target.value })} placeholder="6" /></Field>
                      <Field label="Instructions" className="sm:col-span-2 lg:col-span-3"><Input value={m.instructions ?? ''} onChange={(e) => updateMedicine(i, { instructions: e.target.value })} placeholder="After food, with water" /></Field>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'write' && (
            <div className="card card-pad">
              <h2 className="section-title mb-3">Handwritten prescription</h2>
              <InkCanvas ref={inkRef} height={420} />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => saveInkMutation.mutate()} loading={saveInkMutation.isPending}>
                  <Save className="h-4 w-4" /> Save handwriting
                </Button>
                {rx.versions[0]?.inkStrokesJson && <span className="hint">A saved handwritten layer exists on this version.</span>}
              </div>
            </div>
          )}

          {tab === 'voice' && (
            <div className="card card-pad">
              <h2 className="section-title mb-3">Voice notes</h2>
              <VoiceInput value={voice} onChange={setVoice} />
            </div>
          )}
        </div>

        {/* Right column: diagnosis, advice, follow-up */}
        <div className="space-y-4">
          <div className="card card-pad">
            <h2 className="section-title mb-3">Clinical summary</h2>
            <div className="space-y-3">
              <Field label="Diagnosis"><Textarea rows={2} value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} /></Field>
              <Field label="Advice"><Textarea rows={2} value={advice} onChange={(e) => setAdvice(e.target.value)} /></Field>
              <Field label="Follow-up date"><Input type="date" value={followUpDate} onChange={(e) => setFollowUpDate(e.target.value)} /></Field>
              <Field label="Doctor notes (internal)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </div>
          </div>

          <div className="card card-pad">
            <h2 className="section-title mb-2">Summary</h2>
            <ul className="space-y-1.5 text-sm text-ink-700">
              <li className="flex justify-between"><span>Medicines</span><span className="font-medium">{medicines.filter((m) => m.name.trim()).length}</span></li>
              <li className="flex justify-between"><span>Handwriting</span><span className="font-medium">{rx.versions[0]?.inkStrokesJson ? 'Saved' : 'None'}</span></li>
              <li className="flex justify-between"><span>Voice transcript</span><span className="font-medium">{voice.trim() ? 'Present' : 'None'}</span></li>
              <li className="flex justify-between"><span>Attachments</span><span className="font-medium">{attachments.length}</span></li>
            </ul>
            <p className="hint mt-3">Saving keeps this as a draft. Nothing is issued until you sign.</p>
          </div>

          <div className="card card-pad">
            <h2 className="section-title mb-2">Attach documents</h2>
            <p className="hint mb-2">Combine uploaded reports or scanned documents into this prescription.</p>
            {attachments.length > 0 && (
              <ul className="mb-3 space-y-1.5">
                {attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-50 px-2.5 py-2 text-sm">
                    <span className="truncate text-ink-800">{a.title}</span>
                    <button
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                      className="text-ink-400 hover:text-red-600"
                      aria-label={`Remove ${a.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="label">Add from patient documents</label>
            <Select
              value=""
              onChange={(e) => {
                const doc = patientDocs?.documents.find((d) => d.id === e.target.value);
                if (doc && !attachments.some((a) => a.id === doc.id)) {
                  setAttachments((prev) => [...prev, { id: doc.id, title: doc.title, category: doc.category }]);
                }
              }}
            >
              <option value="">Select a document…</option>
              {patientDocs?.documents
                .filter((d) => !attachments.some((a) => a.id === d.id))
                .map((d) => <option key={d.id} value={d.id}>{d.title} ({humanize(d.category)})</option>)}
            </Select>
            {(!patientDocs || patientDocs.documents.length === 0) && (
              <p className="hint mt-2">No documents uploaded for this patient yet. Upload them from the Documents page.</p>
            )}
          </div>
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => void saveMutation.mutateAsync({}).then(() => toast.success('Draft saved')).catch(() => undefined)} loading={saveMutation.isPending}>
            <Save className="h-4 w-4" /> Save draft
          </Button>
          <Button variant="outline" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> Preview</Button>
          <Button variant="success" onClick={() => setConfirmIssue(true)}>
            <CheckCircle2 className="h-4 w-4" /> Sign &amp; issue
          </Button>
        </div>
      </div>

      <PreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} rx={rx} medicines={medicines} diagnosis={diagnosis} advice={advice} followUpDate={followUpDate} />

      <Modal
        open={confirmIssue}
        onClose={() => setConfirmIssue(false)}
        title="Review before issuing"
        description="Issuing creates an immutable, versioned and audited prescription. It cannot be silently edited afterwards."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmIssue(false)}>Keep editing</Button>
            <Button variant="success" onClick={() => issueMutation.mutate()} loading={issueMutation.isPending}>
              <Send className="h-4 w-4" /> Sign &amp; issue
            </Button>
          </>
        }
      >
        <ul className="space-y-2 text-sm text-ink-700">
          <li className="flex justify-between"><span>Patient</span><span className="font-medium">{rx.patient?.name}</span></li>
          <li className="flex justify-between"><span>Medicines</span><span className="font-medium">{medicines.filter((m) => m.name.trim()).length}</span></li>
          <li className="flex justify-between"><span>Diagnosis</span><span className="max-w-[60%] text-right font-medium">{diagnosis || '—'}</span></li>
        </ul>
        <p className="mt-3 text-sm text-ink-600">
          You are confirming that you have reviewed every medicine and note on this prescription.
        </p>
      </Modal>
    </div>
  );
}

function PreviewModal({ open, onClose, rx, medicines, diagnosis, advice, followUpDate }: {
  open: boolean; onClose: () => void; rx: Prescription;
  medicines: PrescriptionMedicine[]; diagnosis: string; advice: string; followUpDate: string;
}) {
  const valid = medicines.filter((m) => m.name.trim());
  return (
    <Modal open={open} onClose={onClose} title="Prescription preview" description="This is how the issued prescription will read." size="lg"
      footer={<Button onClick={onClose}>Close preview</Button>}>
      <div className="rounded-xl border border-ink-200 p-5">
        <div className="flex items-start justify-between border-b border-ink-200 pb-3">
          <div>
            <p className="text-lg font-semibold text-ink-900">{rx.clinic?.name}</p>
            <p className="hint">{rx.clinic?.address}</p>
            <p className="hint">{rx.clinic?.phone} · {rx.clinic?.email}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold text-brand-700">{rx.prescriptionNo}</p>
            <p className="hint">{formatDateTime(new Date().toISOString())}</p>
          </div>
        </div>
        <div className="grid gap-3 border-b border-ink-200 py-3 sm:grid-cols-2">
          <div>
            <p className="hint">Patient</p>
            <p className="text-sm font-semibold text-ink-900">{rx.patient?.name}</p>
            <p className="hint">{rx.patient?.patientCode}</p>
          </div>
          <div>
            <p className="hint">Doctor</p>
            <p className="text-sm font-semibold text-ink-900">Dr. {rx.doctor?.name}</p>
            <p className="hint">{rx.doctor?.qualification}{rx.doctor?.registrationNo ? ` · Reg ${rx.doctor.registrationNo}` : ''}</p>
          </div>
        </div>
        {diagnosis && <p className="mt-3 text-sm"><span className="font-semibold">Diagnosis: </span>{diagnosis}</p>}
        <div className="mt-4">
          <p className="section-title mb-2">Medicines</p>
          {valid.length === 0 ? <p className="text-sm text-ink-500">No structured medicines (handwritten layer may be attached).</p> : (
            <ol className="space-y-2">
              {valid.map((m, i) => (
                <li key={i} className="rounded-lg bg-ink-50 p-3 text-sm">
                  <p className="font-semibold text-ink-900">{i + 1}. {m.name} {m.strength} {m.form ? `(${m.form.toLowerCase()})` : ''}</p>
                  <p className="hint mt-0.5">
                    {[m.dose, m.frequency, m.duration, m.foodRelation && m.foodRelation !== 'NA' ? humanize(m.foodRelation) : null, m.quantity ? `Qty ${m.quantity}` : null].filter(Boolean).join(' · ')}
                  </p>
                  {m.instructions && <p className="hint">{m.instructions}</p>}
                </li>
              ))}
            </ol>
          )}
        </div>
        {advice && <p className="mt-4 text-sm"><span className="font-semibold">Advice: </span>{advice}</p>}
        {followUpDate && <p className="mt-2 text-sm"><span className="font-semibold">Follow-up: </span>{followUpDate}</p>}
      </div>
    </Modal>
  );
}

