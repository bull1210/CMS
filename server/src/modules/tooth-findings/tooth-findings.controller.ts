import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

export const TOOTH_CONDITIONS = [
  'CARIES',
  'FILLED',
  'MISSING',
  'CROWN',
  'ROOT_CANAL',
  'IMPLANT',
  'FRACTURED',
  'OTHER',
];

// FDI notation: permanent 11-18/21-28/31-38/41-48, primary 51-55/61-65/71-75/81-85.
function isValidFdiTooth(tooth: string) {
  if (!/^\d{2}$/.test(tooth)) return false;
  const quadrant = Number(tooth[0]);
  const position = Number(tooth[1]);
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8;
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5;
  return false;
}

@Controller('tooth-findings')
export class ToothFindingsController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  @Get()
  list(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.prisma.toothFinding.findMany({
      where: {
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(status ? { status } : {}),
      },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { patientId: number; tooth: string; condition: string; note?: string },
  ) {
    if (!body?.patientId || !body?.tooth || !body?.condition) {
      throw new BadRequestException('patientId, tooth and condition are required');
    }
    const tooth = String(body.tooth).trim();
    if (!isValidFdiTooth(tooth)) throw new BadRequestException('Invalid FDI tooth number');
    if (!TOOTH_CONDITIONS.includes(body.condition)) {
      throw new BadRequestException('Invalid condition');
    }
    const finding = await this.prisma.toothFinding.create({
      data: {
        patientId: body.patientId,
        tooth,
        condition: body.condition,
        note: body.note,
        createdById: user.sub,
      },
    });
    await this.timeline.add(
      body.patientId,
      'DIAGNOSIS',
      `Tooth ${tooth}: ${body.condition.toLowerCase().replace('_', ' ')} charted`,
      body.note,
      'ToothFinding',
      finding.id,
    );
    return finding;
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: string; condition?: string; note?: string },
  ) {
    if (body.status && !['ACTIVE', 'RESOLVED'].includes(body.status)) {
      throw new BadRequestException('Invalid status');
    }
    if (body.condition && !TOOTH_CONDITIONS.includes(body.condition)) {
      throw new BadRequestException('Invalid condition');
    }
    const finding = await this.prisma.toothFinding.update({
      where: { id },
      data: {
        status: body.status,
        condition: body.condition,
        note: body.note,
        resolvedAt: body.status === 'RESOLVED' ? new Date() : body.status === 'ACTIVE' ? null : undefined,
      },
    });
    if (body.status === 'RESOLVED') {
      await this.timeline.add(
        finding.patientId,
        'DIAGNOSIS',
        `Tooth ${finding.tooth}: ${finding.condition.toLowerCase().replace('_', ' ')} resolved`,
        undefined,
        'ToothFinding',
        finding.id,
      );
    }
    return finding;
  }
}
