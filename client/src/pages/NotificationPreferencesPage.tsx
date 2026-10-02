import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, Save } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { humanize } from '@/lib/utils';
import { PageHeader } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { InlineSpinner } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface Preferences {
  appointmentUpdates: boolean;
  prescriptionUpdates: boolean;
  reminders: boolean;
  payments: boolean;
  announcements: boolean;
  channels: string[];
}

const CATEGORIES: Array<{ key: keyof Omit<Preferences, 'channels'>; label: string; description: string }> = [
  { key: 'appointmentUpdates', label: 'Appointment updates', description: 'Bookings, confirmations, changes and cancellations.' },
  { key: 'prescriptionUpdates', label: 'Prescription updates', description: 'When a prescription is issued or shared with you.' },
  { key: 'reminders', label: 'Reminders', description: 'Follow-up and token reminders.' },
  { key: 'payments', label: 'Payments', description: 'Payment receipts and outstanding balance notices.' },
  { key: 'announcements', label: 'Clinic announcements', description: 'Notices sent by your clinic.' },
];

const CHANNELS = ['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP', 'SMS'];

export function NotificationPreferencesPage() {
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<{ preferences: Preferences }>('/notifications/preferences'),
  });

  const [prefs, setPrefs] = useState<Preferences | null>(null);
  useEffect(() => { if (data?.preferences) setPrefs(data.preferences); }, [data]);

  const mutation = useMutation({
    mutationFn: (body: Preferences) => api.put('/notifications/preferences', body as unknown as Record<string, unknown>),
    onSuccess: () => toast.success('Preferences saved'),
    onError: (e) => toast.error('Could not save preferences', e instanceof ApiError ? e.message : undefined),
  });

  if (isLoading || !prefs) return <InlineSpinner />;

  return (
    <div>
      <PageHeader title="Notification preferences" subtitle="Choose what you want to be notified about and how" />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <h2 className="section-title mb-3 flex items-center gap-2"><Bell className="h-4 w-4" /> What to notify me about</h2>
          <ul className="divide-y divide-ink-100">
            {CATEGORIES.map((c) => (
              <li key={c.key} className="flex items-start justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.label}</p>
                  <p className="hint">{c.description}</p>
                </div>
                <button
                  role="switch"
                  aria-checked={prefs[c.key]}
                  aria-label={c.label}
                  onClick={() => setPrefs({ ...prefs, [c.key]: !prefs[c.key] })}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-3 before:-inset-y-3 before:content-[''] ${prefs[c.key] ? 'bg-brand-600' : 'bg-ink-300'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${prefs[c.key] ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card card-pad">
          <h2 className="section-title mb-3">How to reach me</h2>
          <ul className="space-y-2">
            {CHANNELS.map((ch) => (
              <li key={ch}>
                <label className="flex items-center gap-3 rounded-lg border border-ink-200 px-3 py-3 text-sm hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={prefs.channels.includes(ch)}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...prefs.channels, ch]
                        : prefs.channels.filter((x) => x !== ch);
                      setPrefs({ ...prefs, channels: next });
                    }}
                    className="h-5 w-5 shrink-0 rounded border-ink-300"
                  />
                  <span className="font-medium text-ink-800">{humanize(ch)}</span>
                  {ch !== 'IN_APP' && <span className="hint ml-auto">Only if configured by your clinic</span>}
                </label>
              </li>
            ))}
          </ul>
          <p className="hint mt-3">In-app notifications are always available. Other channels require clinic configuration.</p>
        </div>
      </div>

      <Button className="mt-4" onClick={() => mutation.mutate(prefs)} loading={mutation.isPending}>
        <Save className="h-4 w-4" /> Save preferences
      </Button>
    </div>
  );
}
