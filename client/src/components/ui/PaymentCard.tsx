import { CreditCard, IndianRupee, Receipt } from 'lucide-react';
import { cn, formatCurrency, formatDateTime, humanize } from '@/lib/utils';
import { StatusBadge } from './StatusBadge';
import type { Invoice, Payment } from '@/types';

export function PaymentCard({ invoice, onPay, className }: { invoice: Invoice; onPay?: (invoice: Invoice) => void; className?: string }) {
  return (
    <div className={cn('card card-pad', className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Invoice</p>
          <p className="text-sm font-semibold text-ink-900">{invoice.invoiceNo}</p>
          {invoice.patient && <p className="text-sm text-ink-600">{invoice.patient.name} · {invoice.patient.patientCode}</p>}
        </div>
        <StatusBadge status={invoice.status} />
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        <Row label="Subtotal" value={formatCurrency(invoice.subtotal, invoice.clinic?.currency)} />
        {invoice.discount > 0 && <Row label="Discount" value={`- ${formatCurrency(invoice.discount, invoice.clinic?.currency)}`} />}
        {invoice.tax > 0 && <Row label="Tax" value={formatCurrency(invoice.tax, invoice.clinic?.currency)} />}
        <div className="divider my-2" />
        <Row label="Total" value={formatCurrency(invoice.total, invoice.clinic?.currency)} strong />
        <Row label="Paid" value={formatCurrency(invoice.amountPaid, invoice.clinic?.currency)} />
        <Row label="Balance" value={formatCurrency(invoice.balance, invoice.clinic?.currency)} strong />
      </dl>
      {onPay && invoice.balance > 0 && (
        <button
          onClick={() => onPay(invoice)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          <IndianRupee className="h-4 w-4" /> Record payment
        </button>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-500">{label}</dt>
      <dd className={cn(strong ? 'font-semibold text-ink-900' : 'text-ink-700')}>{value}</dd>
    </div>
  );
}

export function PaymentHistory({ payments, currency = 'INR' }: { payments: Payment[]; currency?: string }) {
  if (payments.length === 0) return <p className="text-sm text-ink-500">No payments recorded yet.</p>;
  return (
    <ul className="divide-y divide-ink-100">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              {p.method === 'CARD' ? <CreditCard className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
            </span>
            <div>
              <p className="text-sm font-medium text-ink-800">{humanize(p.method)}</p>
              <p className="hint">{formatDateTime(p.createdAt)}{p.reference ? ` · ${p.reference}` : ''}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-ink-900">{formatCurrency(p.amount, currency)}</p>
            {p.refundedAmount > 0 && <p className="hint text-red-600">Refunded {formatCurrency(p.refundedAmount, currency)}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}
