import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ---- Users -------------------------------------------------------------
  // Migrate any legacy front-desk accounts to the current role code so an
  // already-seeded database keeps working after the RECEPTIONIST → ASSISTANT
  // rename (idempotent — a no-op once migrated).
  await prisma.user.updateMany({ where: { role: 'RECEPTIONIST' }, data: { role: 'ASSISTANT' } });

  const users = [
    { name: 'Dr. Sharma', email: 'doctor@clinic.local', role: 'DOCTOR', password: 'doctor123' },
    { name: 'Aarti (Assistant)', email: 'assistant@clinic.local', role: 'ASSISTANT', password: 'assistant123' },
    { name: 'Admin', email: 'admin@clinic.local', role: 'ADMIN', password: 'admin123' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        name: u.name,
        email: u.email,
        role: u.role,
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
  }

  // ---- Settings ----------------------------------------------------------
  const settings: Record<string, string> = {
    'clinic.name': 'Smile Dental Clinic',
    'clinic.doctor': 'Dr. Sharma',
    'clinic.address': '12 MG Road, Chennai',
    'clinic.phone': '+91 98400 00000',
    'billing.taxPercent': '0',
    'billing.currency': 'INR',
    'reminders.offsets': '3d,1d,2h',
    'messaging.webhookUrl': '',
    'recall.months': '6',
    'greetings.birthday': 'on',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // ---- Procedure catalog with treatment flow -----------------------------
  // Chains: RCT1 -> RCT2 -> Crown ; Cleaning -> Whitening
  const proc = async (name: string, cost: number, description?: string) =>
    prisma.procedure.upsert({ where: { name }, update: {}, create: { name, cost, description } });

  const cleaning = await proc('Cleaning (Scaling & Polishing)', 1500, 'Full mouth scaling and polishing');
  const whitening = await proc('Whitening', 8000, 'In-office teeth whitening');
  const filling = await proc('Filling (Composite)', 2000, 'Composite restoration, per tooth');
  const rct1 = await proc('Root Canal Stage 1', 3000, 'Access opening and cleaning');
  const rct2 = await proc('Root Canal Stage 2', 3500, 'Obturation');
  const crown = await proc('Crown (Ceramic)', 6000, 'Ceramic crown, per unit');
  await proc('Extraction', 1500, 'Simple extraction');
  await proc('Implant', 35000, 'Single implant with crown');
  await proc('Consultation', 500, 'Clinical examination and treatment planning');

  await prisma.procedure.update({ where: { id: rct1.id }, data: { followUpId: rct2.id, followUpDays: 14 } });
  await prisma.procedure.update({ where: { id: rct2.id }, data: { followUpId: crown.id, followUpDays: 7 } });
  await prisma.procedure.update({ where: { id: cleaning.id }, data: { followUpId: whitening.id, followUpDays: 30 } });

  // ---- Treatment catalog from the clinic's paper case sheet --------------
  // Grouped under the eight "Treatment Adviced" headings (IOPA, Oral
  // Prophylaxis, Restorations, RCT, Extractions, Prosthesis, Implants,
  // Miscellaneous). Prices are placeholder INR — edit under Treatments.
  // Upsert-by-name means this is safe to re-run and won't touch anything above.
  const catalog: { category: string; name: string; cost: number; description?: string }[] = [
    { category: 'IOPA', name: 'IOPA (Intraoral X-ray)', cost: 300, description: 'Single intraoral periapical radiograph' },
    { category: 'IOPA', name: 'Full Mouth X-ray Series', cost: 2500, description: 'Complete intraoral radiographic survey' },

    { category: 'Oral Prophylaxis', name: 'Oral Prophylaxis (Scaling)', cost: 1500, description: 'Full-mouth scaling and polishing' },
    { category: 'Oral Prophylaxis', name: 'Deep Cleaning (Root Planing)', cost: 3000, description: 'Subgingival scaling and root planing, per quadrant' },

    { category: 'Restorations', name: 'Restoration — Composite', cost: 2000, description: 'Tooth-coloured composite filling, per tooth' },
    { category: 'Restorations', name: 'Restoration — GIC', cost: 1200, description: 'Glass-ionomer restoration, per tooth' },
    { category: 'Restorations', name: 'Restoration — Amalgam', cost: 1000, description: 'Silver amalgam restoration, per tooth' },

    { category: 'RCT', name: 'Root Canal Treatment (Anterior)', cost: 5000, description: 'Endodontic treatment, single-rooted tooth' },
    { category: 'RCT', name: 'Root Canal Treatment (Posterior)', cost: 7000, description: 'Endodontic treatment, molar' },
    { category: 'RCT', name: 'Post & Core', cost: 3500, description: 'Post and core build-up after RCT' },

    { category: 'Extractions', name: 'Extraction — Simple', cost: 1500, description: 'Routine extraction under local anaesthesia' },
    { category: 'Extractions', name: 'Extraction — Surgical', cost: 4000, description: 'Surgical/impacted tooth removal' },

    { category: 'Prosthesis', name: 'Crown — Ceramic (Prosthesis)', cost: 6000, description: 'Ceramic crown, per unit' },
    { category: 'Prosthesis', name: 'Crown — PFM', cost: 5000, description: 'Porcelain-fused-to-metal crown, per unit' },
    { category: 'Prosthesis', name: 'Bridge (per unit)', cost: 5500, description: 'Fixed bridge, priced per unit' },
    { category: 'Prosthesis', name: 'Complete Denture (per arch)', cost: 15000, description: 'Full removable denture, one arch' },
    { category: 'Prosthesis', name: 'Removable Partial Denture', cost: 9000, description: 'Cast/acrylic partial denture' },

    { category: 'Implants', name: 'Dental Implant (Prosthesis)', cost: 35000, description: 'Single implant fixture with crown' },
    { category: 'Implants', name: 'Bone Graft', cost: 12000, description: 'Bone augmentation for implant site' },

    { category: 'Miscellaneous', name: 'Consultation & Examination', cost: 500, description: 'Clinical examination and treatment planning' },
    { category: 'Miscellaneous', name: 'Teeth Whitening (Bleaching)', cost: 8000, description: 'In-office whitening' },
    { category: 'Miscellaneous', name: 'Night Guard / Splint', cost: 4000, description: 'Custom occlusal splint' },
  ];
  for (const c of catalog) {
    await prisma.procedure.upsert({
      where: { name: c.name },
      update: {},
      create: { name: c.name, cost: c.cost, description: `${c.category} — ${c.description ?? ''}`.trim() },
    });
  }

  // ---- Inventory starter catalog (only when empty) -----------------------
  if ((await prisma.inventoryItem.count()) === 0) {
    await prisma.inventoryItem.createMany({
      data: [
        { name: 'Examination gloves (box)', category: 'CONSUMABLE', unit: 'box', stockQty: 10, reorderLevel: 3, costPerUnit: 350 },
        { name: 'Composite resin syringe', category: 'CONSUMABLE', unit: 'pcs', stockQty: 8, reorderLevel: 4, costPerUnit: 1200 },
        { name: 'Lidocaine 2% cartridge', category: 'MEDICINE', unit: 'pcs', stockQty: 50, reorderLevel: 20, costPerUnit: 45 },
        { name: 'Diamond burs (assorted)', category: 'INSTRUMENT', unit: 'pcs', stockQty: 30, reorderLevel: 10, costPerUnit: 150 },
        { name: 'Alginate impression material', category: 'LAB_MATERIAL', unit: 'kg', stockQty: 2, reorderLevel: 1, costPerUnit: 900 },
      ],
    });
  }

  // ---- Sample patients (only when DB is empty) ---------------------------
  if ((await prisma.patient.count()) === 0) {
    const doctor = await prisma.user.findUniqueOrThrow({ where: { email: 'doctor@clinic.local' } });
    const now = Date.now();

    const john = await prisma.patient.create({
      data: {
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
        { patientId: john.id, type: 'NOTE', title: 'Patient registered' },
        { patientId: meera.id, type: 'NOTE', title: 'Patient registered' },
      ],
    });

    // John: completed RCT stage 1 12 days ago -> follow-up due in 2 days
    const rctTreatment = await prisma.treatment.create({
      data: {
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
        patientId: john.id,
        procedureId: rct2.id,
        sourceTreatmentId: rctTreatment.id,
        dueDate: new Date(now + 2 * 86400_000),
        note: 'Recommended after Root Canal Stage 1',
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
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
      data: { patientId: john.id, invoiceId: invoice.id, amount: 2000, method: 'UPI', paidAt: new Date(now - 12 * 86400_000) },
    });
    await prisma.timelineEvent.createMany({
      data: [
        { patientId: john.id, type: 'TREATMENT', title: 'Root Canal Stage 1 — completed', refType: 'Treatment', refId: rctTreatment.id, createdAt: new Date(now - 12 * 86400_000) },
        { patientId: john.id, type: 'INVOICE', title: 'Invoice INV-2026-0001 — ₹3000', refType: 'Invoice', refId: invoice.id, createdAt: new Date(now - 12 * 86400_000) },
        { patientId: john.id, type: 'PAYMENT', title: '₹2000 paid (upi)', createdAt: new Date(now - 12 * 86400_000) },
        { patientId: john.id, type: 'FOLLOW_UP', title: 'Follow-up recommended: Root Canal Stage 2', createdAt: new Date(now - 12 * 86400_000) },
      ],
    });

    // Appointments: John tomorrow 10:30, Meera today in ~2h
    const tomorrow = new Date(now + 86400_000);
    tomorrow.setHours(10, 30, 0, 0);
    await prisma.appointment.create({
      data: {
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
