import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

// Quick-fill templates for common dental diagnoses.
const TEMPLATES = [
  { name: 'Root Canal', diagnosis: 'Irreversible pulpitis', symptoms: 'Severe lingering pain to hot/cold, spontaneous night pain', observations: 'Deep caries approaching pulp, tender on percussion' },
  { name: 'Crown', diagnosis: 'Structurally compromised tooth requiring full coverage', symptoms: 'Fractured/heavily restored tooth', observations: 'Insufficient remaining tooth structure' },
  { name: 'Filling', diagnosis: 'Dental caries', symptoms: 'Sensitivity to sweet/cold', observations: 'Cavitated carious lesion' },
  { name: 'Extraction', diagnosis: 'Non-restorable tooth', symptoms: 'Pain, mobility', observations: 'Gross decay / periodontal involvement, poor prognosis' },
  { name: 'Cleaning', diagnosis: 'Chronic generalized gingivitis', symptoms: 'Bleeding gums', observations: 'Calculus deposits, gingival inflammation' },
];

@Controller('diagnoses')
export class DiagnosesController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  @Get('templates')
  templates() {
    return TEMPLATES;
  }

  @Get()
  list(@Query('patientId') patientId?: string) {
    return this.prisma.diagnosis.findMany({
      where: patientId ? { patientId: Number(patientId) } : {},
      include: { doctor: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body()
    body: { patientId: number; symptoms?: string; observations?: string; diagnosis: string; notes?: string },
  ) {
    if (!body?.patientId || !body?.diagnosis) {
      throw new BadRequestException('patientId and diagnosis are required');
    }
    const dx = await this.prisma.diagnosis.create({
      data: {
        patientId: body.patientId,
        doctorId: user.sub,
        symptoms: body.symptoms,
        observations: body.observations,
        diagnosis: body.diagnosis,
        notes: body.notes,
      },
    });
    await this.timeline.add(body.patientId, 'DIAGNOSIS', `Diagnosis: ${body.diagnosis}`, body.notes, 'Diagnosis', dx.id);
    return dx;
  }
}
