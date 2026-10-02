/**
 * EGAN Clinic demo seed.
 *
 * Creates a realistic small-clinic dataset: EGAN Family Clinic, two doctors
 * (general physician + pediatrician), a receptionist, a nurse, a pharmacist,
 * an attached medical shop, patients with family links, today's appointments,
 * a live queue, completed consultations, and prescriptions covering typed,
 * handwritten, voice-draft, issued and pharmacy-shared states.
 *
 * Run with: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ROLES = ['SUPER_ADMIN', 'CLINIC_OWNER', 'DOCTOR', 'RECEPTIONIST', 'NURSE', 'CLINIC_STAFF', 'PHARMACIST', 'PATIENT'];

const DEMO_PASSWORD = 'Password123!';

function atToday(hours: number, minutes = 0): Date {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function daysAhead(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

async function main() {
  console.log('Seeding EGAN Clinic demo data…');

  // --- Roles -------------------------------------------------------------
  for (const name of ROLES) {
    await prisma.role.upsert({ where: { name }, create: { name, isSystem: true }, update: {} });
  }
  const roleByName = Object.fromEntries((await prisma.role.findMany()).map((r) => [r.name, r.id]));

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  async function makeUser(email: string, fullName: string, phone: string, roles: string[], extra: Record<string, unknown> = {}) {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, fullName, phone, passwordHash, ...extra },
      update: { fullName, phone, passwordHash },
    });
    for (const role of roles) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: roleByName[role]! } },
        create: { userId: user.id, roleId: roleByName[role]! },
        update: {},
      });
    }
    return user;
  }

  // --- Users -------------------------------------------------------------
  const owner = await makeUser('owner@eganclinic.demo', 'Dr. Aisha Rahman', '+91 98100 10001', ['CLINIC_OWNER', 'DOCTOR']);
  const gp = await makeUser('dr.kapoor@eganclinic.demo', 'Dr. Rohit Kapoor', '+91 98100 10002', ['DOCTOR']);
  const ped = await makeUser('dr.iyer@eganclinic.demo', 'Dr. Meera Iyer', '+91 98100 10003', ['DOCTOR']);
  const reception = await makeUser('reception@eganclinic.demo', 'Sunita Verma', '+91 98100 10004', ['RECEPTIONIST']);
  const nurse = await makeUser('nurse@eganclinic.demo', 'Anjali Nair', '+91 98100 10005', ['NURSE']);
  const pharmacist = await makeUser('pharmacist@eganclinic.demo', 'Vikram Singh', '+91 98100 10006', ['PHARMACIST']);
  const patientUser = await makeUser('patient@eganclinic.demo', 'Arjun Mehta', '+91 98100 10007', ['PATIENT']);

  // --- Clinic ------------------------------------------------------------
  const clinic = await prisma.clinic.upsert({
    where: { slug: 'egan-family-clinic' },
    create: {
      name: 'EGAN Family Clinic',
      slug: 'egan-family-clinic',
      address: '12 Lakeview Road, Indiranagar, Bengaluru 560038',
      phone: '+91 80 4123 9000',
      email: 'care@eganfamilyclinic.demo',
      registrationNo: 'KA-CLINIC-2019-44821',
      licenseNo: 'KA-PHC-2019-1123',
      timings: JSON.stringify([
        { day: 'MON', open: '09:00', close: '13:00' }, { day: 'MON', open: '17:00', close: '20:00' },
        { day: 'TUE', open: '09:00', close: '13:00' }, { day: 'TUE', open: '17:00', close: '20:00' },
        { day: 'WED', open: '09:00', close: '13:00' },
        { day: 'THU', open: '09:00', close: '13:00' }, { day: 'THU', open: '17:00', close: '20:00' },
        { day: 'FRI', open: '09:00', close: '13:00' }, { day: 'FRI', open: '17:00', close: '20:00' },
        { day: 'SAT', open: '09:00', close: '14:00' },
        { day: 'SUN', closed: true },
      ]),
      emergencyContact: '+91 98100 10099',
      website: 'https://eganfamilyclinic.demo',
      whatsappNumber: '+91 98100 10001',
      consultationFee: 500,
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      medicalShopEnabled: true,
      createdByUserId: owner.id,
    },
    update: { medicalShopEnabled: true },
  });

  // Staff membership
  for (const u of [owner, gp, ped, reception, nurse]) {
    await prisma.clinicStaff.upsert({
      where: { clinicId_userId: { clinicId: clinic.id, userId: u.id } },
      create: { clinicId: clinic.id, userId: u.id, designation: u.id === owner.id ? 'Owner' : 'Staff' },
      update: {},
    });
  }

  await prisma.clinicSetting.upsert({
    where: { clinicId_key: { clinicId: clinic.id, key: 'medical_shop_enabled' } },
    create: { clinicId: clinic.id, key: 'medical_shop_enabled', value: 'true' },
    update: { value: 'true' },
  });
  await prisma.clinicSetting.upsert({
    where: { clinicId_key: { clinicId: clinic.id, key: 'default_follow_up_days' } },
    create: { clinicId: clinic.id, key: 'default_follow_up_days', value: '7' },
    update: {},
  });
  await prisma.clinicSetting.upsert({
    where: { clinicId_key: { clinicId: clinic.id, key: 'custom_vitals' } },
    create: { clinicId: clinic.id, key: 'custom_vitals', value: JSON.stringify([{ key: 'painScore', label: 'Pain score (0-10)', unit: '' }]) },
    update: {},
  });

  for (const svc of [
    { name: 'Consultation', category: 'CONSULTATION', fee: 500 },
    { name: 'Follow-up consultation', category: 'FOLLOW_UP', fee: 300 },
    { name: 'Dressing / minor procedure', category: 'PROCEDURE', fee: 800 },
    { name: 'Basic blood panel', category: 'TEST', fee: 1200 },
  ]) {
    const exists = await prisma.clinicService.findFirst({ where: { clinicId: clinic.id, name: svc.name } });
    if (!exists) await prisma.clinicService.create({ data: { clinicId: clinic.id, ...svc } });
  }

  // --- Doctors -----------------------------------------------------------
  const doctorSeeds = [
    { userId: owner.id, name: 'Dr. Aisha Rahman', specialization: 'General Physician', qualification: 'MBBS, MD (Internal Medicine)', registrationNo: 'KMC-44821', consultationFee: 600, followUpFee: 350, availableDays: 'MON,TUE,THU,FRI,SAT' },
    { userId: gp.id, name: 'Dr. Rohit Kapoor', specialization: 'General Physician', qualification: 'MBBS, DNB (Family Medicine)', registrationNo: 'KMC-51290', consultationFee: 500, followUpFee: 300, availableDays: 'MON,TUE,WED,THU,FRI' },
    { userId: ped.id, name: 'Dr. Meera Iyer', specialization: 'Pediatrician', qualification: 'MBBS, MD (Pediatrics)', registrationNo: 'KMC-60033', consultationFee: 700, followUpFee: 400, availableDays: 'TUE,WED,SAT' },
  ];
  const doctors: Record<string, { id: string }> = {};
  for (const d of doctorSeeds) {
    const existing = await prisma.doctor.findFirst({ where: { clinicId: clinic.id, userId: d.userId } });
    const created = existing ?? await prisma.doctor.create({
      data: {
        clinicId: clinic.id,
        ...d,
        timings: JSON.stringify([{ day: 'MON', open: '09:00', close: '13:00' }]),
        prescriptionHeader: 'EGAN Family Clinic — Compassionate care for every generation',
        prescriptionFooter: 'Please complete the full course. Contact the clinic for any adverse reaction.',
        defaultMedicineInstructions: 'Take with plenty of water',
        defaultFollowUpDays: 7,
      },
    });
    doctors[d.name] = created;
  }
  const drAisha = doctors['Dr. Aisha Rahman']!;
  const drRohit = doctors['Dr. Rohit Kapoor']!;
  const drMeera = doctors['Dr. Meera Iyer']!;

  // --- Attached medical shop --------------------------------------------
  let pharmacy = await prisma.pharmacy.findFirst({ where: { clinicId: clinic.id, type: 'ATTACHED' } });
  if (!pharmacy) {
    pharmacy = await prisma.pharmacy.create({
      data: {
        name: 'EGAN Medical Store',
        type: 'ATTACHED',
        clinicId: clinic.id,
        phone: '+91 80 4123 9111',
        email: 'store@eganmedical.demo',
        address: 'Ground floor, 12 Lakeview Road, Indiranagar, Bengaluru 560038',
        licenseNo: 'KA-DRUG-2020-7712',
        isEganParticipating: true,
      },
    });
  }
  await prisma.pharmacyUser.upsert({
    where: { pharmacyId_userId: { pharmacyId: pharmacy.id, userId: pharmacist.id } },
    create: { pharmacyId: pharmacy.id, userId: pharmacist.id, role: 'PHARMACIST' },
    update: { isActive: true },
  });

  // An eligible external EGAN medical shop for the Mode C demonstration.
  let externalPharmacy = await prisma.pharmacy.findFirst({ where: { name: 'EGAN Medical Store — Koramangala', type: 'EXTERNAL' } });
  if (!externalPharmacy) {
    externalPharmacy = await prisma.pharmacy.create({
      data: {
        name: 'EGAN Medical Store — Koramangala',
        type: 'EXTERNAL',
        phone: '+91 80 4123 9222',
        address: '5th Block, Koramangala, Bengaluru 560095',
        isEganParticipating: true,
      },
    });
  }

  // --- Medicines reference table ----------------------------------------
  const medicineSeeds = [
    { name: 'Paracetamol', genericName: 'Acetaminophen', strength: '500 mg', form: 'TABLET', defaultFrequency: 'Twice daily', defaultDuration: '3 days', defaultInstructions: 'After food' },
    { name: 'Amoxicillin', genericName: 'Amoxicillin', strength: '500 mg', form: 'CAPSULE', defaultFrequency: 'Three times daily', defaultDuration: '5 days', defaultInstructions: 'After food' },
    { name: 'Cetirizine', genericName: 'Cetirizine', strength: '10 mg', form: 'TABLET', defaultFrequency: 'Once at night', defaultDuration: '5 days', defaultInstructions: 'After food' },
    { name: 'Pantoprazole', genericName: 'Pantoprazole', strength: '40 mg', form: 'TABLET', defaultFrequency: 'Once daily', defaultDuration: '14 days', defaultInstructions: 'Before breakfast' },
    { name: 'Metformin', genericName: 'Metformin', strength: '500 mg', form: 'TABLET', defaultFrequency: 'Twice daily', defaultDuration: '30 days', defaultInstructions: 'With food' },
    { name: 'Salbutamol Inhaler', genericName: 'Salbutamol', strength: '100 mcg', form: 'INHALER', defaultFrequency: 'As needed', defaultDuration: '30 days', defaultInstructions: 'Two puffs when breathless' },
    { name: 'ORS Solution', genericName: 'Oral Rehydration Salts', strength: '1 sachet', form: 'POWDER', defaultFrequency: 'After each loose stool', defaultDuration: '3 days', defaultInstructions: 'Dissolve in 1 litre water' },
    { name: 'Ibuprofen', genericName: 'Ibuprofen', strength: '400 mg', form: 'TABLET', defaultFrequency: 'Twice daily', defaultDuration: '3 days', defaultInstructions: 'After food' },
  ];
  const medicines: Record<string, string> = {};
  for (const m of medicineSeeds) {
    const existing = await prisma.medicine.findFirst({ where: { name: m.name, strength: m.strength } });
    const created = existing ?? await prisma.medicine.create({ data: m });
    medicines[m.name] = created.id;
  }

  // --- Patients ----------------------------------------------------------
  async function makePatient(code: string, data: Record<string, unknown>, userId?: string) {
    const existing = await prisma.patient.findUnique({ where: { patientCode: code } });
    if (existing) return existing;
    return prisma.patient.create({ data: { clinicId: clinic.id, patientCode: code, ...(userId ? { userId } : {}), ...data } as never });
  }

  const arjun = await makePatient('EGAN-P-0001', {
    name: 'Arjun Mehta', dateOfBirth: new Date('1988-04-12'), gender: 'MALE', mobile: '+91 98100 20001',
    email: 'patient@eganclinic.demo', address: '44 Richmond Road, Bengaluru', bloodGroup: 'O+',
    allergies: 'Penicillin (rash)', existingConditions: 'Type 2 diabetes (diagnosed 2021)',
    medicalHistory: 'Appendectomy 2010. Seasonal allergic rhinitis.', currentMedications: 'Metformin 500 mg twice daily',
    emergencyContact: '+91 98100 20099',
  }, patientUser.id);

  const priya = await makePatient('EGAN-P-0002', {
    name: 'Priya Mehta', dateOfBirth: new Date('1991-09-30'), gender: 'FEMALE', mobile: '+91 98100 20002',
    bloodGroup: 'A+', allergies: 'None known', existingConditions: 'Hypothyroidism', currentMedications: 'Levothyroxine 50 mcg once daily',
  });

  const aarav = await makePatient('EGAN-P-0003', {
    name: 'Aarav Mehta', dateOfBirth: new Date('2019-06-15'), gender: 'MALE', bloodGroup: 'O+',
    allergies: 'None known', existingConditions: 'None', medicalHistory: 'Up to date on vaccinations',
  });

  const fatima = await makePatient('EGAN-P-0004', {
    name: 'Fatima Sheikh', dateOfBirth: new Date('1962-01-22'), gender: 'FEMALE', mobile: '+91 98100 20004',
    bloodGroup: 'B+', allergies: 'Sulfa drugs', existingConditions: 'Hypertension, osteoarthritis',
    medicalHistory: 'Cataract surgery 2019 (left eye)', currentMedications: 'Amlodipine 5 mg once daily',
  });

  const rakesh = await makePatient('EGAN-P-0005', {
    name: 'Rakesh Nair', dateOfBirth: new Date('1996-11-08'), gender: 'MALE', mobile: '+91 98100 20005',
    bloodGroup: 'AB+', allergies: 'None known',
  });

  // Family links: Arjun manages Priya and Aarav.
  for (const [member, relation, canView] of [[priya, 'SPOUSE', true], [aarav, 'CHILD', false]] as const) {
    await prisma.patientFamily.upsert({
      where: { primaryPatientId_memberPatientId: { primaryPatientId: arjun.id, memberPatientId: member.id } },
      create: { primaryPatientId: arjun.id, memberPatientId: member.id, relation, canViewRecords: canView },
      update: {},
    });
  }

  // --- Appointments (today) ---------------------------------------------
  async function makeAppointment(patientId: string, doctorId: string, when: Date, status: string, type = 'CONSULTATION', reason?: string) {
    const existing = await prisma.appointment.findFirst({ where: { patientId, doctorId, scheduledAt: when } });
    if (existing) return existing;
    return prisma.appointment.create({
      data: { clinicId: clinic.id, patientId, doctorId, scheduledAt: when, status, type, source: 'RECEPTION', reason, durationMin: 15 },
    });
  }

  const apptArjun = await makeAppointment(arjun.id, drAisha.id, atToday(9, 30), 'CONFIRMED', 'CONSULTATION', 'Diabetes review and fatigue');
  const apptFatima = await makeAppointment(fatima.id, drAisha.id, atToday(10, 0), 'CHECKED_IN', 'CONSULTATION', 'Blood pressure review');
  const apptRakesh = await makeAppointment(rakesh.id, drAisha.id, atToday(10, 30), 'BOOKED', 'CONSULTATION', 'Fever and body ache');
  await makeAppointment(aarav.id, drMeera.id, atToday(11, 0), 'CONFIRMED', 'CONSULTATION', 'Recurrent cough');
  await makeAppointment(priya.id, drRohit.id, atToday(11, 30), 'BOOKED', 'FOLLOW_UP', 'Thyroid follow-up');
  await makeAppointment(priya.id, drRohit.id, daysAhead(3), 'BOOKED', 'FOLLOW_UP', 'Follow-up review');

  // --- Queue (today) -----------------------------------------------------
  const queueDate = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  async function makeToken(patientId: string, doctorId: string, tokenNumber: number, status: string, appointmentId?: string) {
    const existing = await prisma.queueToken.findFirst({ where: { clinicId: clinic.id, doctorId, queueDate, tokenNumber } });
    if (existing) return existing;
    return prisma.queueToken.create({
      data: {
        clinicId: clinic.id, patientId, doctorId, tokenNumber, queueDate, status,
        appointmentId, calledAt: status === 'CONSULTING' || status === 'COMPLETED' ? atToday(9, 15) : null,
        completedAt: status === 'COMPLETED' ? atToday(9, 45) : null,
      },
    });
  }
  await makeToken(fatima.id, drAisha.id, 1, 'COMPLETED');
  await makeToken(arjun.id, drAisha.id, 2, 'CONSULTING', apptArjun.id);
  await makeToken(rakesh.id, drAisha.id, 3, 'WAITING', apptRakesh.id);
  await makeToken(fatima.id, drAisha.id, 4, 'WAITING');

  // --- Consultations & prescriptions ------------------------------------
  async function nextRxNo() {
    const count = await prisma.prescription.count({ where: { clinicId: clinic.id } });
    return `EGAN-RX-${String(count + 1).padStart(5, '0')}`;
  }

  // 1. Completed consultation + issued typed prescription, shared with patient + attached pharmacy.
  const consult1 = await prisma.consultation.create({
    data: {
      clinicId: clinic.id, patientId: fatima.id, doctorId: drAisha.id, status: 'COMPLETED',
      chiefComplaint: 'Routine blood pressure review', symptoms: 'Occasional headache, no chest pain',
      history: 'Hypertension for 8 years, on Amlodipine', examination: 'BP 148/92, pulse 78, no pedal edema',
      diagnosis: 'Essential hypertension, suboptimally controlled',
      doctorNotes: 'Advised salt restriction and daily walking. Continue Amlodipine, review in 2 weeks.',
      advice: 'Low-salt diet, 30 minutes brisk walking daily, home BP monitoring',
      followUpDate: daysAhead(14), startedAt: atToday(9, 0), completedAt: atToday(9, 40),
    },
  });
  await prisma.vital.create({
    data: { clinicId: clinic.id, patientId: fatima.id, consultationId: consult1.id, recordedByUserId: nurse.id, temperature: 36.8, bpSystolic: 148, bpDiastolic: 92, pulse: 78, spo2: 97, weightKg: 71, heightCm: 158, bmi: 28.4, respiratoryRate: 16 },
  });

  const rxNo1 = await nextRxNo();
  const rx1 = await prisma.prescription.create({
    data: {
      clinicId: clinic.id, patientId: fatima.id, doctorId: drAisha.id, consultationId: consult1.id,
      prescriptionNo: rxNo1, status: 'ISSUED', issuedAt: atToday(9, 42),
      versions: {
        create: {
          version: 1, status: 'ISSUED', issuedAt: atToday(9, 42), issuedByUserId: owner.id,
          diagnosis: 'Essential hypertension, suboptimally controlled',
          advice: 'Low-salt diet, daily walking, home BP log',
          followUpDate: daysAhead(14),
          notes: 'Review earlier if BP exceeds 160/100 or if headache worsens.',
          contentHash: 'seed-hash-rx1',
          medicines: {
            create: [
              { medicineId: medicines['Metformin'], name: 'Amlodipine', strength: '5 mg', form: 'TABLET', dose: '1 tablet', frequency: 'Once daily', route: 'ORAL', duration: '30 days', instructions: 'Take in the morning', foodRelation: 'AFTER_FOOD', quantity: '30', sortOrder: 0 },
              { name: 'Telmisartan', strength: '40 mg', form: 'TABLET', dose: '1 tablet', frequency: 'Once daily', route: 'ORAL', duration: '30 days', instructions: 'Monitor for dizziness', foodRelation: 'AFTER_FOOD', quantity: '30', sortOrder: 1 },
            ],
          },
          notesList: { create: [{ type: 'INVESTIGATION', text: 'Lipid profile, fasting' }, { type: 'GENERAL', text: 'Home BP monitoring twice weekly' }] },
        },
      },
    },
    include: { versions: true },
  });
  await prisma.prescription.update({ where: { id: rx1.id }, data: { currentVersionId: rx1.versions[0]!.id } });
  await prisma.prescriptionShare.create({
    data: { prescriptionId: rx1.id, versionId: rx1.versions[0]!.id, targetType: 'PATIENT', patientId: fatima.id, channel: 'IN_APP', sharedByUserId: owner.id, viewedAt: atToday(9, 50) },
  });
  await prisma.prescriptionShare.create({
    data: { prescriptionId: rx1.id, versionId: rx1.versions[0]!.id, targetType: 'ATTACHED_PHARMACY', pharmacyId: pharmacy.id, channel: 'IN_APP', sharedByUserId: owner.id },
  });
  await prisma.pharmacyPrescription.create({
    data: { pharmacyId: pharmacy.id, prescriptionId: rx1.id, status: 'ACCEPTED', reviewedByUserId: pharmacist.id, reviewedAt: atToday(9, 55) },
  });

  // 2. Issued handwritten (ink) prescription for the child, sent to patient only.
  const consult2 = await prisma.consultation.create({
    data: {
      clinicId: clinic.id, patientId: aarav.id, doctorId: drMeera.id, status: 'COMPLETED',
      chiefComplaint: 'Cough for 5 days', symptoms: 'Dry cough worse at night, no fever',
      examination: 'Throat mildly congested, chest clear', diagnosis: 'Viral upper respiratory tract infection',
      advice: 'Warm fluids, steam inhalation', followUpDate: daysAhead(5),
      startedAt: daysAgo(1), completedAt: daysAgo(1),
    },
  });
  await prisma.vital.create({
    data: { clinicId: clinic.id, patientId: aarav.id, consultationId: consult2.id, recordedByUserId: nurse.id, temperature: 37.1, pulse: 96, spo2: 98, weightKg: 18, heightCm: 112, bmi: 14.3, respiratoryRate: 22 },
  });
  const rxNo2 = await nextRxNo();
  const rx2 = await prisma.prescription.create({
    data: {
      clinicId: clinic.id, patientId: aarav.id, doctorId: drMeera.id, consultationId: consult2.id,
      prescriptionNo: rxNo2, status: 'ISSUED', issuedAt: daysAgo(1),
      versions: {
        create: {
          version: 1, status: 'ISSUED', issuedAt: daysAgo(1), issuedByUserId: ped.id,
          diagnosis: 'Viral URTI', advice: 'Warm fluids, rest, steam inhalation',
          inkStrokesJson: JSON.stringify([{ tool: 'pen', color: '#111827', width: 3, points: [{ x: 60, y: 80 }, { x: 180, y: 84 }, { x: 240, y: 120 }] }]),
          contentHash: 'seed-hash-rx2',
          notesList: { create: [{ type: 'GENERAL', text: 'Handwritten prescription — no structured medicine orders.' }] },
        },
      },
    },
    include: { versions: true },
  });
  await prisma.prescription.update({ where: { id: rx2.id }, data: { currentVersionId: rx2.versions[0]!.id } });
  await prisma.prescriptionShare.create({
    data: { prescriptionId: rx2.id, versionId: rx2.versions[0]!.id, targetType: 'PATIENT', patientId: aarav.id, channel: 'IN_APP', sharedByUserId: ped.id },
  });

  // 3. Voice-generated draft awaiting doctor review (never auto-issued).
  const rxNo3 = await nextRxNo();
  const rx3 = await prisma.prescription.create({
    data: {
      clinicId: clinic.id, patientId: rakesh.id, doctorId: drRohit.id,
      prescriptionNo: rxNo3, status: 'DRAFT',
      versions: {
        create: {
          version: 1, status: 'DRAFT',
          voiceTranscript: 'Paracetamol 500 milligram twice daily for three days after food. Plenty of fluids and rest.',
          notes: 'Voice note captured during consultation — pending doctor review.',
        },
      },
    },
    include: { versions: true },
  });
  await prisma.prescription.update({ where: { id: rx3.id }, data: { currentVersionId: rx3.versions[0]!.id } });

  // 4. Issued typed prescription for the diabetic patient, shared with pharmacy (in review).
  const consult4 = await prisma.consultation.create({
    data: {
      clinicId: clinic.id, patientId: arjun.id, doctorId: drAisha.id, status: 'COMPLETED',
      chiefComplaint: 'Fatigue and increased thirst', symptoms: 'Nocturia, mild blurring of vision',
      examination: 'BP 128/82, random glucose 210 mg/dL', diagnosis: 'Type 2 diabetes mellitus, suboptimal control',
      doctorNotes: 'Reinforced diet and adherence. Repeat HbA1c in 3 months.',
      advice: 'Carbohydrate-controlled diet, 45 minutes exercise 5 days a week',
      followUpDate: daysAhead(30), startedAt: daysAgo(20), completedAt: daysAgo(20),
    },
  });
  await prisma.vital.create({
    data: { clinicId: clinic.id, patientId: arjun.id, consultationId: consult4.id, recordedByUserId: nurse.id, temperature: 36.6, bpSystolic: 128, bpDiastolic: 82, pulse: 84, spo2: 98, weightKg: 88, heightCm: 176, bmi: 28.4, respiratoryRate: 16 },
  });
  const rxNo4 = await nextRxNo();
  const rx4 = await prisma.prescription.create({
    data: {
      clinicId: clinic.id, patientId: arjun.id, doctorId: drAisha.id, consultationId: consult4.id,
      prescriptionNo: rxNo4, status: 'SHARED', issuedAt: daysAgo(20),
      versions: {
        create: {
          version: 1, status: 'ISSUED', issuedAt: daysAgo(20), issuedByUserId: owner.id,
          diagnosis: 'Type 2 diabetes mellitus, suboptimal control',
          advice: 'Continue Metformin, dietary modification',
          followUpDate: daysAhead(10),
          contentHash: 'seed-hash-rx4',
          medicines: {
            create: [
              { medicineId: medicines['Metformin'], name: 'Metformin', strength: '500 mg', form: 'TABLET', dose: '1 tablet', frequency: 'Twice daily', route: 'ORAL', duration: '30 days', instructions: 'Take with meals', foodRelation: 'WITH_FOOD', quantity: '60', sortOrder: 0 },
              { medicineId: medicines['Pantoprazole'], name: 'Pantoprazole', strength: '40 mg', form: 'TABLET', dose: '1 tablet', frequency: 'Once daily', route: 'ORAL', duration: '14 days', instructions: 'Before breakfast', foodRelation: 'BEFORE_FOOD', quantity: '14', sortOrder: 1 },
            ],
          },
          notesList: { create: [{ type: 'INVESTIGATION', text: 'HbA1c, fasting lipid profile, serum creatinine' }] },
        },
      },
    },
    include: { versions: true },
  });
  await prisma.prescription.update({ where: { id: rx4.id }, data: { currentVersionId: rx4.versions[0]!.id } });
  await prisma.prescriptionShare.create({
    data: { prescriptionId: rx4.id, versionId: rx4.versions[0]!.id, targetType: 'PATIENT', patientId: arjun.id, channel: 'WHATSAPP', sharedByUserId: owner.id, viewedAt: daysAgo(19) },
  });
  await prisma.prescriptionShare.create({
    data: { prescriptionId: rx4.id, versionId: rx4.versions[0]!.id, targetType: 'ATTACHED_PHARMACY', pharmacyId: pharmacy.id, channel: 'IN_APP', sharedByUserId: owner.id },
  });
  await prisma.pharmacyPrescription.create({
    data: { pharmacyId: pharmacy.id, prescriptionId: rx4.id, status: 'UNDER_REVIEW', reviewedByUserId: pharmacist.id, reviewedAt: daysAgo(20) },
  });

  // --- Follow-ups --------------------------------------------------------
  const fuExists = await prisma.followUp.findFirst({ where: { clinicId: clinic.id, patientId: fatima.id } });
  if (!fuExists) {
    await prisma.followUp.create({
      data: { clinicId: clinic.id, patientId: fatima.id, doctorId: drAisha.id, consultationId: consult1.id, prescriptionId: rx1.id, dueDate: daysAhead(14), instructions: 'Bring home BP log', status: 'PENDING' },
    });
    await prisma.followUp.create({
      data: { clinicId: clinic.id, patientId: aarav.id, doctorId: drMeera.id, consultationId: consult2.id, prescriptionId: rx2.id, dueDate: daysAhead(5), instructions: 'Review if cough persists', status: 'PENDING' },
    });
  }

  // --- Invoices & payments ----------------------------------------------
  const invoiceSeeds = [
    { patientId: fatima.id, consultationId: consult1.id, items: [{ name: 'Consultation', category: 'CONSULTATION', fee: 600, qty: 1 }, { name: 'Basic blood panel', category: 'TEST', fee: 1200, qty: 1 }], discount: 0, paid: 1800 },
    { patientId: aarav.id, consultationId: consult2.id, items: [{ name: 'Consultation', category: 'CONSULTATION', fee: 700, qty: 1 }], discount: 100, paid: 600 },
    { patientId: arjun.id, consultationId: consult4.id, items: [{ name: 'Consultation', category: 'CONSULTATION', fee: 600, qty: 1 }], discount: 0, paid: 0 },
  ];
  let invoiceSeq = await prisma.invoice.count({ where: { clinicId: clinic.id } });
  for (const seed of invoiceSeeds) {
    const exists = await prisma.invoice.findFirst({ where: { clinicId: clinic.id, patientId: seed.patientId, consultationId: seed.consultationId } });
    if (exists) continue;
    invoiceSeq += 1;
    const subtotal = seed.items.reduce((s, i) => s + i.fee * i.qty, 0);
    const total = subtotal - seed.discount;
    const status = seed.paid <= 0 ? 'UNPAID' : seed.paid < total ? 'PARTIALLY_PAID' : 'PAID';
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: clinic.id, patientId: seed.patientId, consultationId: seed.consultationId,
        invoiceNo: `EGAN-INV-${String(invoiceSeq).padStart(5, '0')}`,
        itemsJson: JSON.stringify(seed.items), subtotal, discount: seed.discount, tax: 0, total,
        amountPaid: seed.paid, balance: Math.max(0, total - seed.paid), status, createdByUserId: reception.id,
      },
    });
    if (seed.paid > 0) {
      await prisma.payment.create({
        data: { clinicId: clinic.id, invoiceId: invoice.id, patientId: seed.patientId, amount: seed.paid, method: 'UPI', status: 'SUCCESS', receivedByUserId: reception.id, reference: `UPI-${invoice.invoiceNo}` },
      });
    }
  }

  // --- Audit trail highlights -------------------------------------------
  const auditExists = await prisma.auditLog.findFirst({ where: { clinicId: clinic.id, action: 'PRESCRIPTION_ISSUED' } });
  if (!auditExists) {
    await prisma.auditLog.create({
      data: { clinicId: clinic.id, userId: owner.id, actorName: owner.fullName, action: 'PRESCRIPTION_ISSUED', entityType: 'Prescription', entityId: rx1.id, metadataJson: JSON.stringify({ prescriptionNo: rx1.prescriptionNo, version: 1 }) },
    });
    await prisma.auditLog.create({
      data: { clinicId: clinic.id, userId: owner.id, actorName: owner.fullName, action: 'PRESCRIPTION_SHARED', entityType: 'Prescription', entityId: rx1.id, metadataJson: JSON.stringify({ targets: ['PATIENT', 'ATTACHED_PHARMACY'] }) },
    });
    await prisma.auditLog.create({
      data: { clinicId: clinic.id, userId: pharmacist.id, actorName: pharmacist.fullName, action: 'PHARMACY_ACCESSED_PRESCRIPTION', entityType: 'Prescription', entityId: rx1.id, metadataJson: JSON.stringify({ pharmacyId: pharmacy.id }) },
    });
  }

  console.log('\n✅ Seed complete.\n');
  console.log('Demo accounts (password for all: %s)', DEMO_PASSWORD);
  console.log('  Clinic owner / Doctor : owner@eganclinic.demo');
  console.log('  General physician     : dr.kapoor@eganclinic.demo');
  console.log('  Pediatrician          : dr.iyer@eganclinic.demo');
  console.log('  Receptionist          : reception@eganclinic.demo');
  console.log('  Nurse                 : nurse@eganclinic.demo');
  console.log('  Pharmacist            : pharmacist@eganclinic.demo');
  console.log('  Patient               : patient@eganclinic.demo');
  console.log('\nClinic: EGAN Family Clinic (medical shop ENABLED)');
  console.log('Medical shop: EGAN Medical Store (attached)');
  console.log('External eligible shop: EGAN Medical Store — Koramangala\n');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
