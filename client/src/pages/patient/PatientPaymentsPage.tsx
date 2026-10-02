import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PaymentHistory } from '@/components/ui/PaymentCard';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { Invoice } from '@/types';

export function PatientPaymentsPage() {
  const { data: me, isLoading: loadingMe } = useMyPatient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-invoices', me?.id],
    queryFn: () => api.get<{ items: Invoice[] }>('/billing/invoices', { patientId: me!.id }),
    enabled: Boolean(me?.id),
  });

  if (loadingMe || isLoading) return <InlineSpinner />;
  const items = data?.items ?? [];
  const currency = items[0]?.clinic?.currency ?? 'INR';

  return (
    <div>
      <PageHeader title="My payments" subtitle="Invoices and receipts" />
      {items.length === 0 ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title="No invoices" message="Your bills and receipts will appear here." />
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className="card card-pad">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-ink-900">{i.invoiceNo}</p>
                  <p className="hint">{formatDateTime(i.createdAt)}</p>
                </div>
                <StatusBadge status={i.status} />
              </div>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <div><dt className="hint">Total</dt><dd className="font-semibold text-ink-900">{formatCurrency(i.total, currency)}</dd></div>
                <div><dt className="hint">Paid</dt><dd className="text-ink-800">{formatCurrency(i.amountPaid, currency)}</dd></div>
                <div><dt className="hint">Balance</dt><dd className={i.balance > 0 ? 'font-medium text-amber-700' : 'text-ink-500'}>{formatCurrency(i.balance, currency)}</dd></div>
              </dl>
              {i.payments && i.payments.length > 0 && (
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <PaymentHistory payments={i.payments} currency={currency} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
