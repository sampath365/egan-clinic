import { useQuery } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDate, humanize } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { MedicalDocument } from '@/types';

export function PatientDocumentsPage() {
  const { data: me, isLoading: loadingMe } = useMyPatient();
  const { data, isLoading } = useQuery({
    queryKey: ['my-documents', me?.id],
    queryFn: () => api.get<{ documents: MedicalDocument[] }>('/documents', { patientId: me!.id }),
    enabled: Boolean(me?.id),
  });

  async function download(doc: MedicalDocument) {
    const blob = await api.blob(`/documents/${doc.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = doc.fileName; a.click(); URL.revokeObjectURL(url);
  }

  if (loadingMe || isLoading) return <InlineSpinner />;
  const items = data?.documents ?? [];

  return (
    <div>
      <PageHeader title="My reports" subtitle="Lab reports, scans and certificates shared with you" />
      {items.length === 0 ? (
        <EmptyState icon={<FileText className="h-5 w-5" />} title="No reports" message="Documents shared by your clinic will appear here." />
      ) : (
        <ul className="space-y-2">
          {items.map((d) => (
            <li key={d.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><FileText className="h-5 w-5" /></span>
                <div>
                  <p className="text-sm font-medium text-ink-900">{d.title}</p>
                  <p className="hint">{humanize(d.category)} · {formatDate(d.createdAt)}</p>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => void download(d)}><Download className="h-3.5 w-3.5" /> Download</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
