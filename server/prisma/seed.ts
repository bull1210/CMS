import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { seedClinicDefaults } from '../src/core/clinic-defaults';

// The seed uses a raw PrismaClient (no tenant middleware), so every row sets
// clinicId explicitly. It bootstraps:
//  - the platform SUPER_ADMIN (clinicId null)
//  - one default clinic ("Smile Dental") with demo users — this is what keeps
//    the single-clinic laptop install working: a SaaS of one
//  - sample patients/appointments only when the clinic is empty
const prisma = new PrismaClient();

async function main() {
  // ---- Platform account ---------------------------------------------------
  await prisma.user.upsert({
    where: { email: 'super@aatmam.local' },
    update: {},
    create: {
      name: 'Aatmam Platform Admin',
      email: 'super@aatmam.local',
      role: 'SUPER_ADMIN',
      passwordHash: await bcrypt.hash('super123', 10),
    },
  });

  // ---- Default clinic -----------------------------------------------------
  const clinic = await prisma.clinic.upsert({
    where: { slug: 'smile-dental' },
    update: {},
    create: {
      name: 'Smile Dental Clinic',
      slug: 'smile-dental',
      phone: '+91 98400 00000',
      address: '12 MG Road, Chennai',
    },
  });

  // Migrate any legacy front-desk accounts to the current role code
  // (idempotent — a no-op once migrated).
  await prisma.user.updateMany({ where: { role: 'RECEPTIONIST' }, data: { role: 'ASSISTANT' } });

  const users = [
    { name: 'Dr. Sharma', email: 'doctor@clinic.local', role: 'DOCTOR', password: 'doctor123' },
    { name: 'Aarti (Assistant)', email: 'assistant@clinic.local', role: 'ASSISTANT', password: 'assistant123' },
    { name: 'Admin', email: 'admin@clinic.local', role: 'ADMIN', password: 'admin123' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { clinicId: clinic.id },
      create: {
        clinicId: clinic.id,
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
  }

  // ---- Settings + procedure catalogue (shared with platform onboarding) ---
  await seedClinicDefaults(prisma, clinic.id, {
    'clinic.name': 'Smile Dental Clinic',
    'clinic.doctor': 'Dr. Sharma',
    'clinic.address': '12 MG Road, Chennai',
    'clinic.phone': '+91 98400 00000',
  });

  const procByName = async (name: string) =>
    prisma.procedure.findUniqueOrThrow({ where: { clinicId_name: { clinicId: clinic.id, name } } });
  const rct1 = await procByName('Root Canal Stage 1');
  const rct2 = await procByName('Root Canal Stage 2');

  // ---- Inventory starter catalog (only when empty) -----------------------
  if ((await prisma.inventoryItem.count({ where: { clinicId: clinic.id } })) === 0) {
    await prisma.inventoryItem.createMany({
      data: [
        { name: 'Examination gloves (box)', category: 'CONSUMABLE', unit: 'box', stockQty: 10, reorderLevel: 3, costPerUnit: 350 },
        { name: 'Composite resin syringe', category: 'CONSUMABLE', unit: 'pcs', stockQty: 8, reorderLevel: 4, costPerUnit: 1200 },
        { name: 'Lidocaine 2% cartridge', category: 'MEDICINE', unit: 'pcs', stockQty: 50, reorderLevel: 20, costPerUnit: 45 },
        { name: 'Diamond burs (assorted)', category: 'INSTRUMENT', unit: 'pcs', stockQty: 30, reorderLevel: 10, costPerUnit: 150 },
        { name: 'Alginate impression material', category: 'LAB_MATERIAL', unit: 'kg', stockQty: 2, reorderLevel: 1, costPerUnit: 900 },
      ].map((i) => ({ ...i, clinicId: clinic.id })),
    });
  }

  // ---- Sample patients (only when the clinic is empty) --------------------
  if ((await prisma.patient.count({ where: { clinicId: clinic.id } })) === 0) {
    const doctor = await prisma.user.findUniqueOrThrow({ where: { email: 'doctor@clinic.local' } });
    const now = Date.now();
    const cid = clinic.id;

    const john = await prisma.patient.create({
      data: {
        clinicId: cid,
        code: 'P-0001',
        name: 'John Mathew',
        gender: 'MALE',
        dob: new Date('1988-04-12'),
        phone: '+919840011111',
        whatsapp: '+919840011111',
        email: 'john@example.com',
        address: '4 Lake View Rd, Chennai',
        medicalHistory: JSON.stringify({ diabetes: true, allergies: 'Penicillin', medications: 'Metformin 500mg' }),
        dentalHistory: JSON.stringify({ notes: 'Filling on 26 done elsewhere in 2023' }),
      },
    });
    const meera = await prisma.patient.create({
      data: {
        clinicId: cid,
        code: 'P-0002',
        name: 'Meera Krishnan',
        gender: 'FEMALE',
        dob: new Date('1994-09-30'),
        phone: '+919840022222',
        whatsapp: '+919840022222',
        address: '22 Anna Nagar, Chennai',
        medicalHistory: JSON.stringify({}),
        dentalHistory: JSON.stringify({}),
      },
    });
    await prisma.timelineEvent.createMany({
      data: [
        { clinicId: cid, patientId: john.id, type: 'NOTE', title: 'Patient registered' },
        { clinicId: cid, patientId: meera.id, type: 'NOTE', title: 'Patient registered' },
      ],
    });

    // John: completed RCT stage 1 12 days ago -> follow-up due in 2 days
    const rctTreatment = await prisma.treatment.create({
      data: {
        clinicId: cid,
        patientId: john.id,
        procedureId: rct1.id,
        doctorId: doctor.id,
        status: 'COMPLETED',
        toothRefs: '36',
        cost: rct1.cost,
        performedAt: new Date(now - 12 * 86400_000),
      },
    });
    await prisma.followUp.create({
      data: {
        clinicId: cid,
        patientId: john.id,
        procedureId: rct2.id,
        sourceTreatmentId: rctTreatment.id,
        dueDate: new Date(now + 2 * 86400_000),
        note: 'Recommended after Root Canal Stage 1',
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: cid,
        number: 'INV-2026-0001',
        patientId: john.id,
        treatmentId: rctTreatment.id,
        subtotal: rct1.cost,
        total: rct1.cost,
        status: 'PARTIAL',
        items: { create: [{ description: rct1.name, qty: 1, unitPrice: rct1.cost, amount: rct1.cost }] },
      },
    });
    await prisma.payment.create({
      data: { clinicId: cid, patientId: john.id, invoiceId: invoice.id, amount: 2000, method: 'UPI', paidAt: new Date(now - 12 * 86400_000) },
    });
    await prisma.timelineEvent.createMany({
      data: [
        { clinicId: cid, patientId: john.id, type: 'TREATMENT', title: 'Root Canal Stage 1 — completed', refType: 'Treatment', refId: rctTreatment.id, createdAt: new Date(now - 12 * 86400_000) },
        { clinicId: cid, patientId: john.id, type: 'INVOICE', title: 'Invoice INV-2026-0001 — ₹3000', refType: 'Invoice', refId: invoice.id, createdAt: new Date(now - 12 * 86400_000) },
        { clinicId: cid, patientId: john.id, type: 'PAYMENT', title: '₹2000 paid (upi)', createdAt: new Date(now - 12 * 86400_000) },
        { clinicId: cid, patientId: john.id, type: 'FOLLOW_UP', title: 'Follow-up recommended: Root Canal Stage 2', createdAt: new Date(now - 12 * 86400_000) },
      ],
    });

    // Appointments: John tomorrow 10:30, Meera today in ~2h
    const tomorrow = new Date(now + 86400_000);
    tomorrow.setHours(10, 30, 0, 0);
    await prisma.appointment.create({
      data: {
        clinicId: cid,
        patientId: john.id,
        doctorId: doctor.id,
        startsAt: tomorrow,
        endsAt: new Date(tomorrow.getTime() + 45 * 60_000),
        type: 'PROCEDURE',
        notes: 'Root Canal Stage 2',
      },
    });
    const todaySlot = new Date(now + 2 * 3600_000);
    await prisma.appointment.create({
      data: {
        clinicId: cid,
        patientId: meera.id,
        doctorId: doctor.id,
        startsAt: todaySlot,
        endsAt: new Date(todaySlot.getTime() + 30 * 60_000),
        type: 'CONSULTATION',
      },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
