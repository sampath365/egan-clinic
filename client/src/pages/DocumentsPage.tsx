import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { formatDate, humanize } from '@/lib/utils';
import { PageHeader, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Search } from '@/components/ui/Search';
import { FileUploader } from '@/components/ui/FileUploader';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { usePermissions } from '@/hooks/usePermissions';
import { PERMISSIONS } from '@/lib/permissions';
import type { MedicalDocument, Paginated, Patient } from '@/types';

export function DocumentsPage() {
  const { activeClinic } = useAuth();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const toast = useToast();
  const clinicId = activeClinic?.id;
  const [search, setSearch] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { data: patients } = useQuery({
    queryKey: ['patients-picker-docs', clinicId, search],
    queryFn: () => api.get<Paginated<Patient>>('/patients', { clinicId, search, pageSize: 20 }),
    enabled: Boolean(clinicId),
  });

  const { data: documents } = useQuery({
    queryKey: ['documents', patient?.id],
    queryFn: () => api.get<{ documents: MedicalDocument[] }>('/documents', { patientId: patient!.id }),
    enabled: Boolean(patient),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/documents/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['documents'] }); toast.success('Document deleted'); },
  });

  async function download(doc: MedicalDocument) {
    const blob = await api.blob(`/documents/${doc.id}/download`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = doc.fileName; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader title="Medical documents" subtitle="Upload and retrieve lab reports, scans and certificates" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-1">
          <h2 className="section-title mb-3">Select a patient</h2>
          <Search value={search} onChange={setSearch} placeholder="Search patients" />
          <ul className="scroll-thin mt-3 max-h-[28rem] space-y-1 overflow-y-auto">
            {patients?.items.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setPatient(p)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm ${patient?.id === p.id ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:bg-ink-50'}`}
                >
                  <span className="font-medium text-ink-800">{p.name}</span>
                  <span className="hint">{p.patientCode}</span>
                </button>
              </li>
            ))}
            {patients?.items.length === 0 && <p className="hint px-1 py-3">No matching patients.</p>}
          </ul>
        </div>

        <div className="lg:col-span-2">
          {!patient ? (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="Choose a patient" message="Select a patient to view and upload their documents." />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-ink-900">{patient.name}</h2>
                  <p className="hint">{patient.patientCode}</p>
                </div>
                {can(PERMISSIONS.DOCUMENT_UPLOAD) && <Button onClick={() => setUploadOpen(true)}><Upload className="h-4 w-4" /> Upload</Button>}
              </div>

              {!documents?.documents.length ? (
                <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents" message="Upload a lab report or scan to attach it to this patient." />
              ) : (
                <ul className="space-y-2">
                  {documents.documents.map((d) => (
                    <li key={d.id} className="card flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink-100 text-ink-600"><FileText className="h-5 w-5" /></span>
                        <div>
                          <p className="text-sm font-medium text-ink-900">{d.title}</p>
                          <p className="hint">{humanize(d.category)} · {d.fileName} · {formatDate(d.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => void download(d)}><Download className="h-3.5 w-3.5" /> Download</Button>
                        {can(PERMISSIONS.DOCUMENT_DELETE) && (
                          <Button size="sm" variant="ghost" onClick={() => remove.mutate(d.id)} aria-label="Delete document"><Trash2 className="h-3.5 w-3.5 text-ink-400" /></Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title={`Upload document — ${patient?.name ?? ''}`} size="lg">
        {patient && (
          <FileUploader
            defaultTitle=""
            onUpload={async (file, meta) => {
              const form = new FormData();
              form.append('file', file);
              await api.post(`/documents?patientId=${patient.id}&title=${encodeURIComponent(meta.title)}&category=${meta.category}`, form);
              void qc.invalidateQueries({ queryKey: ['documents', patient.id] });
              toast.success('Document uploaded');
            }}
          />
        )}
      </Modal>
    </div>
  );
}
