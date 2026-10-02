import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import { ageFromDob } from '@/lib/utils';
import { Avatar, PageHeader, EmptyState } from '@/components/ui/Layout';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useMyPatient } from './PatientHomePage';
import type { Patient } from '@/types';

export function PatientProfilePage() {
  const { data: me, isLoading } = useMyPatient();

  const { data: family } = useQuery({
    queryKey: ['my-family', me?.id],
    queryFn: () => api.get<{ family: Array<{ id: string; relation: string; canViewRecords: boolean; member: Patient }> }>(`/patients/${me!.id}/family`),
    enabled: Boolean(me?.id),
  });

  if (isLoading) return <InlineSpinner />;
  if (!me) return <EmptyState icon={<Users className="h-5 w-5" />} title="No profile linked" />;

  return (
    <div>
      <PageHeader title="My profile" subtitle={me.patientCode} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-2">
          <div className="flex items-center gap-4">
            <Avatar name={me.name} size={56} />
            <div>
              <p className="text-lg font-semibold text-ink-900">{me.name}</p>
              <p className="hint">{ageFromDob(me.dateOfBirth)}{me.gender ? ` · ${me.gender.toLowerCase()}` : ''}{me.bloodGroup ? ` · ${me.bloodGroup}` : ''}</p>
            </div>
          </div>
          <dl className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Detail label="Mobile" value={me.mobile} />
            <Detail label="Email" value={me.email} />
            <Detail label="Address" value={me.address} />
            <Detail label="Blood group" value={me.bloodGroup} />
            <Detail label="Allergies" value={me.allergies} />
            <Detail label="Existing conditions" value={me.existingConditions} />
            <Detail label="Current medications" value={me.currentMedications} />
          </dl>
          <p className="hint mt-4">Contact your clinic to update clinical details. Medical information is protected by role-based access.</p>
        </div>

        <div className="card card-pad">
          <h2 className="section-title mb-3">Family members</h2>
          {!family?.family.length ? <p className="text-sm text-ink-500">No family members linked to your record.</p> : (
            <ul className="divide-y divide-ink-100">
              {family.family.map((f) => (
                <li key={f.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm font-medium text-ink-800">{f.member.name}</p>
                    <p className="hint">{f.relation.toLowerCase()}</p>
                  </div>
                  <span className="hint">{f.canViewRecords ? 'Records shared' : 'Records private'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="hint mt-3">One family member's medical records are not visible to another unless sharing is enabled.</p>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-800">{value || '—'}</dd>
    </div>
  );
}
