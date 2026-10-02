import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IndianRupee, Plus, Receipt, RotateCcw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { formatCurrency, formatDateTime, humanize } from '@/lib/utils';
import { PageHeader, EmptyState, StatCard } from '@/components/ui/Layout';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { PaymentCard } from '@/components/ui/PaymentCard';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { Invoice, Paginated, Payment, Patient } from '@/types';

export function BillingPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const clinicId = activeClinic?.id;
  const currency = activeClinic?.currency ?? 'INR';
  const [status, setStatus] = useState('');
  const [newInvoice, setNewInvoice] = useState(false);
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [refundPayment, setRefundPayment] = useState<Payment | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', clinicId, status],
    queryFn: () => api.get<Paginated<Invoice>>('/billing/invoices', { clinicId, status, pageSize: 50 }),
    enabled: Boolean(clinicId),
  });

  const { data: payments } = useQuery({
    queryKey: ['payments', clinicId],
    queryFn: () => api.get<{ payments: Payment[] }>('/billing/payments', { clinicId }),
    enabled: Boolean(clinicId),
  });

  const totals = (data?.items ?? []).reduce(
    (acc, i) => ({ billed: acc.billed + i.total, collected: acc.collected + i.amountPaid, outstanding: acc.outstanding + i.balance }),
    { billed: 0, collected: 0, outstanding: 0 },
  );

  const columns: Column<Invoice>[] = [
    { key: 'no', header: 'Invoice', render: (i) => <span className="font-medium text-ink-900">{i.invoiceNo}</span> },
    {
      key: 'patient', header: 'Patient',
      render: (i) => (<div><p className="font-medium text-ink-900">{i.patient?.name}</p><p className="hint">{i.patient?.patientCode}</p></div>),
    },
    { key: 'date', header: 'Date', render: (i) => <span className="hint">{formatDateTime(i.createdAt)}</span> },
    { key: 'total', header: 'Total', align: 'right', render: (i) => <span>{formatCurrency(i.total, currency)}</span> },
    { key: 'paid', header: 'Paid', align: 'right', render: (i) => <span>{formatCurrency(i.amountPaid, currency)}</span> },
    { key: 'balance', header: 'Balance', align: 'right', render: (i) => <span className={i.balance > 0 ? 'font-medium text-amber-700' : 'text-ink-500'}>{formatCurrency(i.balance, currency)}</span> },
    { key: 'status', header: 'Status', render: (i) => <StatusBadge status={i.status} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (i) => (
        <div className="flex justify-end gap-1.5">
          {can(PERMISSIONS.PAYMENT_MANAGE) && i.balance > 0 && i.status !== 'CANCELLED' && (
            <Button size="sm" onClick={(e) => { e.stopPropagation(); setPayInvoice(i); }}><IndianRupee className="h-3.5 w-3.5" /> Pay</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Billing & payments"
        subtitle="Invoices, collections and outstanding balances"
        actions={can(PERMISSIONS.BILLING_MANAGE) && <Button onClick={() => setNewInvoice(true)}><Plus className="h-4 w-4" /> New invoice</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total billed" value={formatCurrency(totals.billed, currency)} icon={<Receipt className="h-5 w-5" />} />
        <StatCard label="Collected" value={formatCurrency(totals.collected, currency)} tone="success" icon={<IndianRupee className="h-5 w-5" />} />
        <StatCard label="Outstanding" value={formatCurrency(totals.outstanding, currency)} tone="warning" icon={<RotateCcw className="h-5 w-5" />} />
      </div>

      <div className="mb-4 max-w-xs">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED', 'CANCELLED'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        rowKey={(i) => i.id}
        loading={isLoading}
        empty={<EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" message="Create an invoice after a consultation or procedure." />}
      />

      <div className="mt-6">
        <h2 className="section-title mb-3">Recent payments</h2>
        {!payments?.payments.length ? (
          <div className="card card-pad text-sm text-ink-500">No payments recorded yet.</div>
        ) : (
          <div className="card divide-y divide-ink-100">
            {payments.payments.slice(0, 20).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{p.patient?.name}</p>
                  <p className="hint">{p.invoice?.invoiceNo} · {humanize(p.method)} · {formatDateTime(p.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-ink-900">{formatCurrency(p.amount, currency)}</span>
                  <StatusBadge status={p.status} />
                  {can(PERMISSIONS.PAYMENT_REFUND) && p.refundedAmount < p.amount && (
                    <Button size="sm" variant="ghost" onClick={() => setRefundPayment(p)}>Refund</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <NewInvoiceModal open={newInvoice} onClose={() => setNewInvoice(false)} clinicId={clinicId} currency={currency} onDone={() => void qc.invalidateQueries({ queryKey: ['invoices'] })} />
      {payInvoice && (
        <RecordPaymentModal
          invoice={payInvoice}
          onClose={() => setPayInvoice(null)}
          currency={currency}
          onDone={() => { void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['payments'] }); setPayInvoice(null); }}
        />
      )}
      {refundPayment && (
        <RefundModal
          payment={refundPayment}
          onClose={() => setRefundPayment(null)}
          currency={currency}
          onDone={() => { void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['payments'] }); setRefundPayment(null); }}
        />
      )}
    </div>
  );
}

function NewInvoiceModal({ open, onClose, clinicId, currency, onDone }: { open: boolean; onClose: () => void; clinicId?: string; currency: string; onDone: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState('');
  const [items, setItems] = useState([{ name: 'Consultation', category: 'CONSULTATION', fee: '500', qty: '1' }]);
  const [discount, setDiscount] = useState('0');

  const { data: patients } = useQuery({
    queryKey: ['patients-picker-billing', clinicId, search],
    queryFn: () => api.get<Paginated<Patient>>('/patients', { clinicId, search, pageSize: 6 }),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => api.post('/billing/invoices', {
      clinicId, patientId,
      items: items.map((i) => ({ name: i.name, category: i.category, fee: Number(i.fee) || 0, qty: Number(i.qty) || 1 })),
      discount: Number(discount) || 0,
    }),
    onSuccess: () => { toast.success('Invoice created'); onDone(); onClose(); },
    onError: (e) => toast.error('Could not create invoice', e instanceof ApiError ? e.message : undefined),
  });

  const subtotal = items.reduce((s, i) => s + (Number(i.fee) || 0) * (Number(i.qty) || 1), 0);

  return (
    <Modal open={open} onClose={onClose} title="New invoice" size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!patientId || items.length === 0}>Create invoice</Button></>}>
      <div className="space-y-4">
        <Field label="Patient" required>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" />
          <div className="scroll-thin mt-2 max-h-36 space-y-1 overflow-y-auto">
            {patients?.items.map((p) => (
              <button key={p.id} onClick={() => setPatientId(p.id)} className={`flex w-full justify-between rounded-lg border px-3 py-2 text-left text-sm ${patientId === p.id ? 'border-brand-400 bg-brand-50' : 'border-ink-200'}`}>
                <span className="font-medium text-ink-800">{p.name}</span><span className="hint">{p.patientCode}</span>
              </button>
            ))}
          </div>
        </Field>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="section-title">Line items</p>
            <Button size="sm" variant="secondary" onClick={() => setItems((i) => [...i, { name: '', category: 'OTHER', fee: '0', qty: '1' }])}><Plus className="h-3.5 w-3.5" /> Add</Button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                <Input value={it.name} placeholder="Description" onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                <Select value={it.category} onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, category: e.target.value } : x))}>
                  {['CONSULTATION', 'FOLLOW_UP', 'PROCEDURE', 'TEST', 'OTHER'].map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
                <Input inputMode="decimal" value={it.fee} placeholder="Fee" onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, fee: e.target.value } : x))} />
                <Input inputMode="numeric" value={it.qty} placeholder="Qty" onChange={(e) => setItems((prev) => prev.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} />
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Discount"><Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
          <div className="flex items-end pb-2">
            <p className="text-sm text-ink-700">Subtotal <span className="ml-2 font-semibold text-ink-900">{formatCurrency(subtotal, currency)}</span></p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RecordPaymentModal({ invoice, onClose, currency, onDone }: { invoice: Invoice; onClose: () => void; currency: string; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(invoice.balance));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post('/billing/payments', { invoiceId: invoice.id, amount: Number(amount), method, reference: reference || undefined }),
    onSuccess: () => { toast.success('Payment recorded'); onDone(); },
    onError: (e) => toast.error('Could not record payment', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal open onClose={onClose} title="Record payment" size="md"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!amount || Number(amount) <= 0}>Record payment</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><PaymentCard invoice={invoice} /></div>
        <Field label="Amount" required hint={`Outstanding ${formatCurrency(invoice.balance, currency)}`}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['CASH', 'UPI', 'CARD', 'ONLINE', 'OTHER'].map((m) => <option key={m} value={m}>{humanize(m)}</option>)}
          </Select>
        </Field>
        <Field label="Reference" className="sm:col-span-2"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI / card reference (optional)" /></Field>
      </div>
    </Modal>
  );
}
function RefundModal({ payment, onClose, currency, onDone }: { payment: Payment; onClose: () => void; currency: string; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(payment.amount - payment.refundedAmount));
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post(`/billing/payments/${payment.id}/refund`, { amount: Number(amount), reason: reason || undefined }),
    onSuccess: () => { toast.success('Refund recorded'); onDone(); },
    onError: (e) => toast.error('Could not refund', e instanceof ApiError ? e.message : undefined),
  });

  return (
    <Modal open onClose={onClose} title="Refund payment" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!amount || Number(amount) <= 0}>Refund</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Refundable: {formatCurrency(payment.amount - payment.refundedAmount, currency)}</p>
        <Field label="Amount" required><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
