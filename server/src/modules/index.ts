import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { clinicRoutes } from './clinic/routes.js';
import { doctorRoutes } from './doctors/routes.js';
import { patientRoutes } from './patients/routes.js';
import { appointmentRoutes } from './appointments/routes.js';
import { queueRoutes } from './queue/routes.js';
import { consultationRoutes } from './consultations/routes.js';
import { prescriptionRoutes } from './prescriptions/routes.js';
import { followUpRoutes } from './followups/routes.js';
import { pharmacyRoutes, pharmacyPrescriptionRoutes } from './pharmacy/routes.js';
import { billingRoutes } from './billing/routes.js';
import { documentRoutes } from './documents/routes.js';
import { notificationRoutes } from './notifications/routes.js';
import { reportRoutes } from './reports/routes.js';
import { auditRoutes } from './audit/routes.js';
import { assetRoutes } from './assets/routes.js';

/**
 * Module registry. Each domain module owns its routes and is registered under a
 * distinct prefix so modules remain independently maintainable.
 */
export async function registerModules(app: FastifyInstance) {
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(clinicRoutes, { prefix: '/clinics' });
  await app.register(doctorRoutes, { prefix: '/doctors' });
  await app.register(patientRoutes, { prefix: '/patients' });
  await app.register(appointmentRoutes, { prefix: '/appointments' });
  await app.register(queueRoutes, { prefix: '/queue' });
  await app.register(consultationRoutes, { prefix: '/consultations' });
  await app.register(followUpRoutes, { prefix: '/follow-ups' });
  await app.register(prescriptionRoutes, { prefix: '/prescriptions' });
  await app.register(pharmacyRoutes, { prefix: '/pharmacies' });
  await app.register(pharmacyPrescriptionRoutes, { prefix: '/pharmacy-prescriptions' });
  await app.register(billingRoutes, { prefix: '/billing' });
  await app.register(documentRoutes, { prefix: '/documents' });
  await app.register(notificationRoutes, { prefix: '/notifications' });
  await app.register(reportRoutes, { prefix: '/reports' });
  await app.register(auditRoutes, { prefix: '/audit' });
  await app.register(assetRoutes, { prefix: '/assets' });
}
