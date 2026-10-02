import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Package, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import type { PharmacyPrescription } from '@/types';

const NEXT_ACTIONS: Record<string, Array<{ status: string; label: string; variant: 'primary' | 'secondary' | 'success' | 'danger' }>> = {
  RECEIVED: [
    { status: 'UNDER_REVIEW', label: 'Start review', variant: 'primary' },
    { status: 'ACCEPTED', label: 'Accept', variant: 'success' },
    { status: 'CLARIFICATION_REQUIRED', label: 'Request clarification', variant: 'secondary' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  UNDER_REVIEW: [
    { status: 'ACCEPTED', label: 'Accept', variant: 'success' },
    { status: 'CLARIFICATION_REQUIRED', label: 'Request clarification', variant: 'secondary' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  CLARIFICATION_REQUIRED: [
    { status: 'UNDER_REVIEW', label: 'Resume review', variant: 'primary' },
    { status: 'ACCEPTED', label: 'Accept', variant: 'success' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  ACCEPTED: [
    { status: 'PROCESSING', label: 'Mark processing', variant: 'primary' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  PROCESSING: [
    { status: 'READY', label: 'Mark ready', variant: 'success' },
    { status: 'REJECTED', label: 'Reject', variant: 'danger' },
  ],
  READY: [{ status: 'COMPLETED', label: 'Mark completed', variant: 'success' }],
};

export function PharmacyPrescriptionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [noteModal, setNoteModal] = useState<null | 'CLARIFICATION_REQUIRED' | 'REJECTED'>(null);
  const [note, setNote] = useState('');
  const [orderOpen, setOrderOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-prescription', id],
    queryFn: () => api.get<{ pharmacyPrescription: PharmacyPrescription }>(`/pharmacy-prescriptions/${id}`),
    enabled: Boolean(id),
  });

  const pp = data?.pharmacyPrescription;
  const rx = pp?.prescription;
  const version = rx?.versions?.find((v) => v.status === 'ISSUED') ?? rx?.versions?.[0];

  const transition = useMutation({
    mutationFn: (payload: { status: string; note?: string; rejectionReason?: string }) =>
      api.post(`/pharmacy-prescriptions/${id}/status`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pharmacy-prescription', id] });
      void qc.invalidateQueries({ queryKey: ['pharmacy-prescriptions'] });
      toast.success('Prescription status updated');
      setNoteModal(null);
      setNote('');
    },
    onError: (e) => toast.error('Could not update status', e instanceof ApiError ? e.message : undefined),
  });

  const orderMutation = useMutation({
    mutationFn: (items: Array<{ name: string; available: boolean; quantity?: string; unitPrice: number }>) =>
      api.post(`/pharmacy-prescriptions/${id}/order`, { fulfillment: 'PICKUP', items }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pharmacy-prescription', id] });
      toast.success('Order created', 'Stock availability is confirmed by your pharmacy.');
      setOrderOpen(false);
    },
    onError: (e) => toast.error('Could not create order', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading || !pp) return <InlineSpinner label="Loading prescription…" />;

  const actions = NEXT_ACTIONS[pp.status] ?? [];

  return (
    <div>
      <button onClick={() => navigate('/pharmacy')} className="mb-3 -my-1 inline-flex items-center gap-1.5 py-2 text-sm font-medium text-ink-600 hover:text-ink-900 sm:my-0 sm:py-0">
        <ArrowLeft className="h-4 w-4" /> Prescription inbox
      </button>

      <PageHeader
        title={rx?.prescriptionNo ?? 'Prescription'}
        subtitle={`${rx?.patient?.name} · Dr. ${rx?.doctor?.name} · received ${formatDateTime(pp.receivedAt)}`}
        actions={<StatusBadge status={pp.status} />}
      />

      {rx?.patient?.allergies && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span><span className="font-semibold">Allergy alert: </span>{rx.patient.allergies}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-2">
          <div className="border-b border-ink-200 pb-3">
            <p className="text-base font-semibold text-ink-900">{rx?.clinic?.name}</p>
            <p className="hint">{rx?.clinic?.address} · {rx?.clinic?.phone}</p>
          </div>
          <div className="grid gap-3 border-b border-ink-200 py-3 sm:grid-cols-2">
            <div>
              <p className="hint">Patient</p>
              <p className="text-sm font-semibold text-ink-900">{rx?.patient?.name}</p>
              <p className="hint">{rx?.patient?.patientCode}</p>
            </div>
            <div>
              <p className="hint">Prescribing doctor</p>
              <p className="text-sm font-semibold text-ink-900">Dr. {rx?.doctor?.name}</p>
              <p className="hint">{rx?.doctor?.qualification}{rx?.doctor?.registrationNo ? ` · Reg ${rx.doctor.registrationNo}` : ''}</p>
            </div>
          </div>

          {version?.diagnosis && <p className="mt-3 text-sm"><span className="font-semibold">Diagnosis: </span>{version.diagnosis}</p>}

          <div className="mt-4">
            <p className="section-title mb-2">Prescribed medicines</p>
            {!version?.medicines.length ? (
              <p className="text-sm text-ink-500">No structured medicines — this is a handwritten prescription. Review the handwriting below.</p>
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

          {version?.notesList?.length ? (
            <div className="mt-4">
              <p className="section-title mb-2">Notes</p>
              <ul className="space-y-1 text-sm text-ink-700">{version.notesList.map((n) => <li key={n.id}>• {n.text}</li>)}</ul>
            </div>
          ) : null}

          {version?.inkStrokesJson && (
            <div className="mt-4">
              <p className="section-title mb-2">Handwritten prescription</p>
              <p className="text-sm text-ink-600">This prescription was written by hand. It is preserved exactly as issued.</p>
            </div>
          )}

          {version?.advice && <p className="mt-4 text-sm"><span className="font-semibold">Advice: </span>{version.advice}</p>}
        </div>

        <div className="space-y-4">
          <div className="card card-pad">
            <p className="section-title mb-3">Pharmacist actions</p>
            <div className="space-y-2">
              {actions.length === 0 && <p className="text-sm text-ink-500">No further action is available for this status.</p>}
              {actions.map((a) => (
                <Button
                  key={a.status}
                  variant={a.variant}
                  className="w-full justify-start"
                  onClick={() => (a.status === 'CLARIFICATION_REQUIRED' || a.status === 'REJECTED') ? setNoteModal(a.status) : transition.mutate({ status: a.status })}
                  loading={transition.isPending}
                >
                  {a.status === 'ACCEPTED' && <CheckCircle2 className="h-4 w-4" />} {a.label}
                </Button>
              ))}
            </div>
            <p className="hint mt-3">The pharmacy verifies the prescription independently. Nothing is dispensed automatically.</p>
          </div>

          {['ACCEPTED', 'PROCESSING', 'READY'].includes(pp.status) && (
            <div className="card card-pad">
              <p className="section-title mb-2 flex items-center gap-2"><Package className="h-4 w-4" /> Order</p>
              {pp.order ? (
                <div className="text-sm">
                  <p className="text-ink-700">Status: <StatusBadge status={pp.order.status} /></p>
                  <p className="hint mt-1">Total {pp.order.totalAmount.toFixed(2)} · {humanize(pp.order.fulfillment)}</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-ink-600">Create an order once you have confirmed stock for the prescribed medicines.</p>
                  <Button className="mt-3 w-full" variant="secondary" onClick={() => setOrderOpen(true)}>Create order</Button>
                </>
              )}
            </div>
          )}

          {pp.clarificationNote && (
            <div className="card card-pad border-amber-200 bg-amber-50">
              <p className="text-sm font-medium text-amber-800">Clarification requested</p>
              <p className="mt-1 text-sm text-amber-700">{pp.clarificationNote}</p>
            </div>
          )}
          {pp.rejectionReason && (
            <div className="card card-pad border-red-200 bg-red-50">
              <p className="text-sm font-medium text-red-800">Rejected</p>
              <p className="mt-1 text-sm text-red-700">{pp.rejectionReason}</p>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={noteModal !== null}
        onClose={() => { setNoteModal(null); setNote(''); }}
        title={noteModal === 'REJECTED' ? 'Reject prescription' : 'Request clarification'}
        description={noteModal === 'REJECTED' ? 'Provide a reason. The prescribing doctor will be notified.' : 'Describe what needs clarifying.'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setNoteModal(null); setNote(''); }}>Cancel</Button>
            <Button
              variant={noteModal === 'REJECTED' ? 'danger' : 'primary'}
              disabled={!note.trim()}
              loading={transition.isPending}
              onClick={() => transition.mutate(noteModal === 'REJECTED' ? { status: 'REJECTED', rejectionReason: note } : { status: 'CLARIFICATION_REQUIRED', note })}
            >
              Submit
            </Button>
          </>
        }
      >
        <Field label={noteModal === 'REJECTED' ? 'Reason' : 'Clarification note'} required>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Modal>

      <OrderModal open={orderOpen} onClose={() => setOrderOpen(false)} medicines={version?.medicines ?? []} onSubmit={(items) => orderMutation.mutate(items)} loading={orderMutation.isPending} />
    </div>
  );
}

function OrderModal({ open, onClose, medicines, onSubmit, loading }: {
  open: boolean; onClose: () => void; loading: boolean;
  medicines: Array<{ name: string; strength?: string | null; quantity?: string | null }>;
  onSubmit: (items: Array<{ name: string; available: boolean; quantity?: string; unitPrice: number }>) => void;
}) {
  const [rows, setRows] = useState<Array<{ name: string; available: boolean; quantity: string; unitPrice: string }>>([]);

  // Seed rows from the prescription when the modal opens.
  if (open && rows.length === 0 && medicines.length > 0) {
    setRows(medicines.map((m) => ({ name: `${m.name}${m.strength ? ` ${m.strength}` : ''}`, available: true, quantity: m.quantity ?? '', unitPrice: '' })));
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create order"
      description="Confirm what is actually in stock. Availability is never assumed."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={loading}
            disabled={rows.length === 0}
            onClick={() => onSubmit(rows.map((r) => ({ name: r.name, available: r.available, quantity: r.quantity || undefined, unitPrice: Number(r.unitPrice) || 0 })))}
          >
            Create order
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border border-ink-200 p-3">
            <p className="text-sm font-medium text-ink-900">{r.name}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Available">
                <Select value={r.available ? 'yes' : 'no'} onChange={(e) => setRows((prev) => prev.map((x, idx) => idx === i ? { ...x, available: e.target.value === 'yes' } : x))}>
                  <option value="yes">In stock</option>
                  <option value="no">Not available</option>
                </Select>
              </Field>
              <Field label="Quantity"><Input value={r.quantity} onChange={(e) => setRows((prev) => prev.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} /></Field>
              <Field label="Unit price"><Input inputMode="decimal" value={r.unitPrice} onChange={(e) => setRows((prev) => prev.map((x, idx) => idx === i ? { ...x, unitPrice: e.target.value } : x))} /></Field>
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyState icon={<Package className="h-5 w-5" />} title="No structured medicines" message="This prescription has no structured medicine lines to order." />}
      </div>
    </Modal>
  );
}
