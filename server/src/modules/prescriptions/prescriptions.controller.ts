import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

export interface Medicine {
  name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  notes?: string;
}

export interface PrescriptionContent {
  medicines: Medicine[];
  advice?: string;
}

export interface RxTemplate {
  name: string;
  content: PrescriptionContent;
  builtin?: boolean;
}

// Settings keys holding the doctor's editable Rx library (JSON text, per the
// no-Json-columns rule — parsed/serialised here at the service boundary).
const TEMPLATES_KEY = 'prescriptions.templates';
const FORMULARY_KEY = 'prescriptions.formulary';

// Common dental prescription templates for one-click fill. Shipped as
// read-only defaults; the doctor's own templates are stored in Settings and
// appended to these.
const TEMPLATES: { name: string; content: PrescriptionContent }[] = [
  {
    name: 'Post-extraction',
    content: {
      medicines: [
        { name: 'Amoxicillin 500mg', frequency: '1-1-1', duration: '5 days', notes: 'After food' },
        { name: 'Ibuprofen 400mg', frequency: '1-0-1', duration: '3 days', notes: 'After food' },
        { name: 'Chlorhexidine mouthwash', frequency: 'Twice daily', duration: '7 days' },
      ],
      advice: 'Avoid hot food for 24h. Do not rinse vigorously today. Cold compress for swelling.',
    },
  },
  {
    name: 'Post-root canal',
    content: {
      medicines: [
        { name: 'Ibuprofen 400mg', frequency: '1-0-1', duration: '3 days', notes: 'After food' },
      ],
      advice: 'Avoid chewing on the treated side until the permanent restoration is placed.',
    },
  },
  {
    name: 'Dental pain (analgesic)',
    content: {
      medicines: [
        { name: 'Paracetamol 650mg', frequency: '1-1-1', duration: '3 days' },
      ],
      advice: 'Review if pain persists beyond 3 days.',
    },
  },
];

// Starting formulary — seeded into Settings the first time it is edited, and
// used as the fallback until then. Powers the medicine-name autocomplete.
const DEFAULT_FORMULARY: Medicine[] = [
  { name: 'Amoxicillin 500mg', frequency: '1-1-1', duration: '5 days', notes: 'After food' },
  { name: 'Amoxicillin + Clavulanate 625mg', frequency: '1-0-1', duration: '5 days', notes: 'After food' },
  { name: 'Metronidazole 400mg', frequency: '1-1-1', duration: '5 days', notes: 'After food' },
  { name: 'Ibuprofen 400mg', frequency: '1-0-1', duration: '3 days', notes: 'After food' },
  { name: 'Paracetamol 650mg', frequency: '1-1-1', duration: '3 days' },
  { name: 'Diclofenac 50mg', frequency: '1-0-1', duration: '3 days', notes: 'After food' },
  { name: 'Chlorhexidine mouthwash', frequency: 'Twice daily', duration: '7 days' },
  { name: 'Pantoprazole 40mg', frequency: '1-0-0', duration: '5 days', notes: 'Before food' },
];

@Controller('prescriptions')
export class PrescriptionsController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
    private audit: AuditService,
  ) {}

  /** Built-in templates first, then the clinic's own. */
  @Get('templates')
  async templates(): Promise<RxTemplate[]> {
    const custom = await this.readJson<RxTemplate[]>(TEMPLATES_KEY, []);
    return [
      ...TEMPLATES.map((t) => ({ ...t, builtin: true })),
      ...custom.map((t) => ({ ...t, builtin: false })),
    ];
  }

  /** Replaces the custom template list (built-ins are never persisted). */
  @Roles('DOCTOR', 'ADMIN')
  @Put('templates')
  async saveTemplates(@CurrentUser() user: AuthUser, @Body() body: { templates: RxTemplate[] }) {
    const clean = (body?.templates ?? [])
      .filter((t) => t?.name?.trim() && !t.builtin)
      .map((t) => ({
        name: t.name.trim(),
        content: {
          medicines: cleanMedicines(t.content?.medicines),
          advice: t.content?.advice?.trim() || undefined,
        },
      }))
      .filter((t) => t.content.medicines.length);
    await this.writeJson(TEMPLATES_KEY, clean);
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, TEMPLATES_KEY);
    return this.templates();
  }

  /** Medicine master list backing the name autocomplete. */
  @Get('formulary')
  async formulary(): Promise<Medicine[]> {
    return this.readJson<Medicine[]>(FORMULARY_KEY, DEFAULT_FORMULARY);
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put('formulary')
  async saveFormulary(@CurrentUser() user: AuthUser, @Body() body: { medicines: Medicine[] }) {
    const clean = cleanMedicines(body?.medicines);
    await this.writeJson(FORMULARY_KEY, clean);
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, FORMULARY_KEY);
    return clean;
  }

  @Get()
  async list(@Query('patientId') patientId?: string) {
    const rows = await this.prisma.prescription.findMany({
      where: patientId ? { patientId: Number(patientId) } : {},
      include: {
        doctor: { select: { id: true, name: true } },
        patient: { select: { id: true, name: true, code: true, dob: true, gender: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, content: safeParse(r.content) }));
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const r = await this.prisma.prescription.findUniqueOrThrow({
      where: { id },
      include: {
        doctor: { select: { id: true, name: true } },
        patient: true,
      },
    });
    return { ...r, content: safeParse(r.content) };
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { patientId: number; content: PrescriptionContent },
  ) {
    if (!body?.patientId || !body?.content?.medicines?.length) {
      throw new BadRequestException('patientId and at least one medicine are required');
    }
    const rx = await this.prisma.prescription.create({
      data: {
        patientId: body.patientId,
        doctorId: user.sub,
        content: JSON.stringify(body.content),
      },
    });
    await this.timeline.add(
      body.patientId,
      'PRESCRIPTION',
      `Prescription: ${body.content.medicines.map((m) => m.name).join(', ')}`,
      body.content.advice,
      'Prescription',
      rx.id,
    );
    return { ...rx, content: body.content };
  }

  private async readJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (!row) return fallback;
    try {
      const parsed = JSON.parse(row.value);
      return Array.isArray(parsed) ? (parsed as T) : fallback;
    } catch {
      return fallback;
    }
  }

  private async writeJson(key: string, value: unknown) {
    const json = JSON.stringify(value);
    await this.prisma.setting.upsert({
      where: { key },
      update: { value: json },
      create: { key, value: json },
    });
  }
}

function cleanMedicines(meds?: Medicine[]): Medicine[] {
  return (meds ?? [])
    .filter((m) => m?.name?.trim())
    .map((m) => ({
      name: m.name.trim(),
      dose: m.dose?.trim() || undefined,
      frequency: m.frequency?.trim() || undefined,
      duration: m.duration?.trim() || undefined,
      notes: m.notes?.trim() || undefined,
    }));
}

function safeParse(s: string) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}
