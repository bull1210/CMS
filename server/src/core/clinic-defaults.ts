import type { PrismaClient } from '@prisma/client';

/**
 * Everything a brand-new clinic starts with: default settings and the
 * procedure catalogue (from the clinic paper case sheet, grouped under the
 * eight "Treatment Adviced" headings, placeholder INR prices).
 *
 * Called from two places with an UNSCOPED Prisma client and an explicit
 * clinicId: the dev seed (prisma/seed.ts) and the platform module's
 * clinic-creation endpoint. Idempotent — safe to re-run for a clinic.
 */
export const DEFAULT_SETTINGS: Record<string, string> = {
  'clinic.name': 'New Clinic',
  'clinic.doctor': '',
  'clinic.address': '',
  'clinic.phone': '',
  'billing.taxPercent': '0',
  'billing.currency': 'INR',
  'reminders.offsets': '3d,1d,2h',
  'messaging.webhookUrl': '',
  'recall.months': '6',
  'greetings.birthday': 'on',
};

interface CatalogEntry {
  name: string;
  cost: number;
  description?: string;
  category?: string;
}

const CORE_PROCEDURES: CatalogEntry[] = [
  { name: 'Cleaning (Scaling & Polishing)', cost: 1500, description: 'Full mouth scaling and polishing' },
  { name: 'Whitening', cost: 8000, description: 'In-office teeth whitening' },
  { name: 'Filling (Composite)', cost: 2000, description: 'Composite restoration, per tooth' },
  { name: 'Root Canal Stage 1', cost: 3000, description: 'Access opening and cleaning' },
  { name: 'Root Canal Stage 2', cost: 3500, description: 'Obturation' },
  { name: 'Crown (Ceramic)', cost: 6000, description: 'Ceramic crown, per unit' },
  { name: 'Extraction', cost: 1500, description: 'Simple extraction' },
  { name: 'Implant', cost: 35000, description: 'Single implant with crown' },
  { name: 'Consultation', cost: 500, description: 'Clinical examination and treatment planning' },
];

const CASE_SHEET_CATALOG: CatalogEntry[] = [
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

export async function seedClinicDefaults(
  prisma: PrismaClient,
  clinicId: number,
  overrides: Record<string, string> = {},
) {
  // Settings — keep existing values on re-run.
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...overrides })) {
    await prisma.setting.upsert({
      where: { clinicId_key: { clinicId, key } },
      update: {},
      create: { clinicId, key, value },
    });
  }

  // Procedure catalogue — upsert by per-clinic name.
  const upsertProc = (p: CatalogEntry) =>
    prisma.procedure.upsert({
      where: { clinicId_name: { clinicId, name: p.name } },
      update: {},
      create: {
        clinicId,
        name: p.name,
        cost: p.cost,
        description: p.category ? `${p.category} — ${p.description ?? ''}`.trim() : p.description ?? null,
      },
    });

  const byName = new Map<string, { id: number }>();
  for (const p of CORE_PROCEDURES) byName.set(p.name, await upsertProc(p));
  for (const p of CASE_SHEET_CATALOG) await upsertProc(p);

  // Treatment-flow chains: RCT1 -> RCT2 -> Crown ; Cleaning -> Whitening
  const link = async (from: string, to: string, days: number) => {
    const a = byName.get(from);
    const b = byName.get(to);
    if (!a || !b) return;
    await prisma.procedure.update({ where: { id: a.id }, data: { followUpId: b.id, followUpDays: days } });
  };
  await link('Root Canal Stage 1', 'Root Canal Stage 2', 14);
  await link('Root Canal Stage 2', 'Crown (Ceramic)', 7);
  await link('Cleaning (Scaling & Polishing)', 'Whitening', 30);
}
