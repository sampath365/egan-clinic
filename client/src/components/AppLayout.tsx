import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity, BarChart3, Bell, CalendarDays, ChevronDown, ClipboardList,
  FileText, LayoutDashboard, ListOrdered, LogOut, Menu, Package, Pill, Receipt,
  Settings, Stethoscope, Users, X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/hooks/useNotifications';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { Avatar } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { PERMISSIONS } from '@/lib/permissions';

interface NavItem { to: string; label: string; icon: React.ReactNode; permission?: string; roles?: string[] }

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/appointments', label: 'Appointments', icon: <CalendarDays className="h-4 w-4" />, permission: PERMISSIONS.APPOINTMENT_VIEW },
  { to: '/queue', label: 'Queue', icon: <ListOrdered className="h-4 w-4" />, permission: PERMISSIONS.QUEUE_VIEW },
  { to: '/patients', label: 'Patients', icon: <Users className="h-4 w-4" />, permission: PERMISSIONS.PATIENT_VIEW },
  { to: '/consultations', label: 'Consultations', icon: <Stethoscope className="h-4 w-4" />, permission: PERMISSIONS.CONSULTATION_VIEW },
  { to: '/prescriptions', label: 'Prescriptions', icon: <ClipboardList className="h-4 w-4" />, permission: PERMISSIONS.PRESCRIPTION_VIEW },
  { to: '/follow-ups', label: 'Follow-ups', icon: <Activity className="h-4 w-4" />, permission: PERMISSIONS.CONSULTATION_VIEW },
  { to: '/pharmacy', label: 'Medical shop', icon: <Pill className="h-4 w-4" />, roles: ['PHARMACIST', 'CLINIC_OWNER', 'SUPER_ADMIN'] },
  { to: '/billing', label: 'Billing', icon: <Receipt className="h-4 w-4" />, permission: PERMISSIONS.BILLING_VIEW },
  { to: '/documents', label: 'Documents', icon: <FileText className="h-4 w-4" />, permission: PERMISSIONS.DOCUMENT_VIEW },
  { to: '/reports', label: 'Reports', icon: <BarChart3 className="h-4 w-4" />, permission: PERMISSIONS.REPORT_VIEW },
  { to: '/doctors', label: 'Doctors', icon: <Stethoscope className="h-4 w-4" />, permission: PERMISSIONS.DOCTOR_MANAGE },
  { to: '/settings', label: 'Settings', icon: <Settings className="h-4 w-4" />, permission: PERMISSIONS.CLINIC_SETTINGS_MANAGE },
  { to: '/audit', label: 'Audit log', icon: <ClipboardList className="h-4 w-4" />, permission: PERMISSIONS.AUDIT_VIEW },
];

const PATIENT_NAV: NavItem[] = [
  { to: '/me', label: 'Home', icon: <LayoutDashboard className="h-4 w-4" /> },
  { to: '/me/appointments', label: 'Appointments', icon: <CalendarDays className="h-4 w-4" /> },
  { to: '/me/queue', label: 'My token', icon: <ListOrdered className="h-4 w-4" /> },
  { to: '/me/visits', label: 'My visits', icon: <Stethoscope className="h-4 w-4" /> },
  { to: '/me/prescriptions', label: 'Prescriptions', icon: <ClipboardList className="h-4 w-4" /> },
  { to: '/me/documents', label: 'Reports', icon: <FileText className="h-4 w-4" /> },
  { to: '/me/payments', label: 'Payments', icon: <Receipt className="h-4 w-4" /> },
  { to: '/me/notifications', label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { to: '/me/profile', label: 'Profile', icon: <Users className="h-4 w-4" /> },
];

export function AppLayout() {
  const { user, clinics, activeClinic, setActiveClinicId, can, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  const patientOnly = (user?.scopes.patientIds.length ?? 0) > 0 && (user?.scopes.clinicIds.length ?? 0) === 0;
  const items = patientOnly ? PATIENT_NAV : NAV.filter((i) => {
    if (i.roles && !hasRole(...i.roles)) return false;
    if (i.permission && !can(i.permission)) return false;
    return true;
  });

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-ink-200 px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
          <Package className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink-900">EGAN Clinic</p>
          <p className="truncate text-xs text-ink-500">{activeClinic?.name ?? 'No clinic'}</p>
        </div>
      </div>
      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/' || item.to === '/me'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'bg-brand-50 text-brand-700' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
            )}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-ink-200 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <Avatar name={user?.fullName} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink-900">{user?.fullName}</p>
            <p className="truncate text-xs text-ink-500">{user?.roles.map(humanize).join(', ')}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={handleLogout}>
          <LogOut className="h-4 w-4" /> Sign out
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-ink-200 bg-white lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-900/40" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="absolute left-0 top-0 h-full w-72 bg-white shadow-pop">
            <button className="absolute right-3 top-4 text-ink-400" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-ink-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>

          {!patientOnly && clinics.length > 0 && (
            <div className="relative">
              <select
                value={activeClinic?.id ?? ''}
                onChange={(e) => setActiveClinicId(e.target.value)}
                aria-label="Active clinic"
                className="max-w-[10rem] appearance-none rounded-lg border border-ink-300 bg-white py-2 pl-3 pr-8 text-sm font-medium text-ink-800 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 sm:max-w-none"
              >
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Button variant="ghost" size="icon" onClick={() => setNotifOpen((o) => !o)} aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`}>
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setNotifOpen(false)} aria-hidden />
                  <div className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop animate-slide-up">
                    <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
                      <p className="text-sm font-semibold text-ink-900">Notifications</p>
                      {unreadCount > 0 && <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => void markAllRead()}>Mark all read</button>}
                    </div>
                    <div className="scroll-thin max-h-96 overflow-y-auto">
                      {notifications.length === 0 && <p className="px-4 py-8 text-center text-sm text-ink-500">You have no notifications.</p>}
                      {notifications.map((n) => (
                        <button
                          key={n.id}
                          onClick={() => void markRead(n.id)}
                          className={cn('block w-full border-b border-ink-100 px-4 py-3 text-left hover:bg-ink-50', !n.isRead && 'bg-brand-50/40')}
                        >
                          <p className="text-sm font-medium text-ink-900">{n.title}</p>
                          <p className="mt-0.5 text-sm text-ink-600">{n.body}</p>
                          <p className="hint mt-1">{formatDateTime(n.createdAt)}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="scroll-thin flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export { Link };
