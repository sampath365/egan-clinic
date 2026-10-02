import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/AppLayout';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { LoginPage } from '@/pages/LoginPage';
import { VerifyPage } from '@/pages/VerifyPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { AppointmentsPage } from '@/pages/AppointmentsPage';
import { QueuePage } from '@/pages/QueuePage';
import { PatientsPage } from '@/pages/PatientsPage';
import { PatientDetailPage } from '@/pages/PatientDetailPage';
import { ConsultationsPage } from '@/pages/ConsultationsPage';
import { ConsultationPage } from '@/pages/ConsultationPage';
import { PrescriptionsPage } from '@/pages/PrescriptionsPage';
import { PrescriptionDetailPage } from '@/pages/PrescriptionDetailPage';
import { PrescriptionEditorPage } from '@/pages/PrescriptionEditorPage';
import { FollowUpsPage } from '@/pages/FollowUpsPage';
import { PharmacyPage } from '@/pages/pharmacy/PharmacyPage';
import { PharmacyPrescriptionPage } from '@/pages/pharmacy/PharmacyPrescriptionPage';
import { BillingPage } from '@/pages/BillingPage';
import { DocumentsPage } from '@/pages/DocumentsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { DoctorsPage } from '@/pages/DoctorsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AuditPage } from '@/pages/AuditPage';
import { ForbiddenPage } from '@/pages/ForbiddenPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { PatientHomePage } from '@/pages/patient/PatientHomePage';
import { PatientAppointmentsPage } from '@/pages/patient/PatientAppointmentsPage';
import { PatientPrescriptionsPage } from '@/pages/patient/PatientPrescriptionsPage';
import { PatientVisitsPage } from '@/pages/patient/PatientVisitsPage';
import { PatientDocumentsPage } from '@/pages/patient/PatientDocumentsPage';
import { PatientPaymentsPage } from '@/pages/patient/PatientPaymentsPage';
import { PatientProfilePage } from '@/pages/patient/PatientProfilePage';
import { PermissionGate } from '@/components/PermissionGate';
import { PERMISSIONS } from '@/lib/permissions';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/verify/:prescriptionNo" element={<VerifyPage />} />

      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<DashboardPage />} />
        <Route path="appointments" element={<PermissionGate permission={PERMISSIONS.APPOINTMENT_VIEW}><AppointmentsPage /></PermissionGate>} />
        <Route path="queue" element={<PermissionGate permission={PERMISSIONS.QUEUE_VIEW}><QueuePage /></PermissionGate>} />
        <Route path="patients" element={<PermissionGate permission={PERMISSIONS.PATIENT_VIEW}><PatientsPage /></PermissionGate>} />
        <Route path="patients/:id" element={<PermissionGate permission={PERMISSIONS.PATIENT_VIEW}><PatientDetailPage /></PermissionGate>} />
        <Route path="consultations" element={<PermissionGate permission={PERMISSIONS.CONSULTATION_VIEW}><ConsultationsPage /></PermissionGate>} />
        <Route path="consultations/:id" element={<PermissionGate permission={PERMISSIONS.CONSULTATION_VIEW}><ConsultationPage /></PermissionGate>} />
        <Route path="prescriptions" element={<PermissionGate permission={PERMISSIONS.PRESCRIPTION_VIEW}><PrescriptionsPage /></PermissionGate>} />
        <Route path="prescriptions/:id" element={<PermissionGate permission={PERMISSIONS.PRESCRIPTION_VIEW}><PrescriptionDetailPage /></PermissionGate>} />
        <Route path="prescriptions/:id/edit" element={<PermissionGate permission={PERMISSIONS.PRESCRIPTION_CREATE}><PrescriptionEditorPage /></PermissionGate>} />
        <Route path="follow-ups" element={<PermissionGate permission={PERMISSIONS.CONSULTATION_VIEW}><FollowUpsPage /></PermissionGate>} />
        <Route path="pharmacy" element={<PermissionGate anyRole={['PHARMACIST', 'CLINIC_OWNER', 'SUPER_ADMIN']}><PharmacyPage /></PermissionGate>} />
        <Route path="pharmacy/:id" element={<PermissionGate anyRole={['PHARMACIST', 'CLINIC_OWNER', 'SUPER_ADMIN']}><PharmacyPrescriptionPage /></PermissionGate>} />
        <Route path="billing" element={<PermissionGate permission={PERMISSIONS.BILLING_VIEW}><BillingPage /></PermissionGate>} />
        <Route path="documents" element={<PermissionGate permission={PERMISSIONS.DOCUMENT_VIEW}><DocumentsPage /></PermissionGate>} />
        <Route path="reports" element={<PermissionGate permission={PERMISSIONS.REPORT_VIEW}><ReportsPage /></PermissionGate>} />
        <Route path="doctors" element={<PermissionGate permission={PERMISSIONS.DOCTOR_MANAGE}><DoctorsPage /></PermissionGate>} />
        <Route path="settings" element={<PermissionGate permission={PERMISSIONS.CLINIC_SETTINGS_MANAGE}><SettingsPage /></PermissionGate>} />
        <Route path="audit" element={<PermissionGate permission={PERMISSIONS.AUDIT_VIEW}><AuditPage /></PermissionGate>} />

        {/* Patient portal */}
        <Route path="me" element={<PatientHomePage />} />
        <Route path="me/appointments" element={<PatientAppointmentsPage />} />
        <Route path="me/visits" element={<PatientVisitsPage />} />
        <Route path="me/prescriptions" element={<PatientPrescriptionsPage />} />
        <Route path="me/documents" element={<PatientDocumentsPage />} />
        <Route path="me/payments" element={<PatientPaymentsPage />} />
        <Route path="me/profile" element={<PatientProfilePage />} />

        <Route path="forbidden" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
