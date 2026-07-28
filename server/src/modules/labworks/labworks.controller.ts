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
import { Roles } from '../../core/auth.guard';

const WORK_TYPES = ['CROWN', 'BRIDGE', 'DENTURE', 'ALIGNER', 'IMPLANT_PART', 'OTHER'];
const STATUSES = ['SENT', 'RECEIVED', 'FITTED', 'REDO', 'CANCELLED'];

@Controller('labworks')
export class LabworksController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  @Get()
  list(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.prisma.labWork.findMany({
      where: {
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        patient: { select: { id: true, name: true, code: true } },
        treatment: { include: { procedure: { select: { name: true } } } },
      },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(
    @Body()
    body: {
      patientId: number;
      treatmentId?: number;
      labName: string;
      workType?: string;
      toothRefs?: string;
      shade?: string;
      dueAt?: string;
      cost?: number;
      notes?: string;
    },
  ) {
    if (!body?.patientId || !body?.labName) {
      throw new BadRequestException('patientId and labName are required');
    }
    const workType = body.workType && WORK_TYPES.includes(body.workType) ? body.workType : 'CROWN';
    const labWork = await this.prisma.labWork.create({
      data: {
        patientId: body.patientId,
        treatmentId: body.treatmentId || undefined,
        labName: body.labName,
        workType,
        toothRefs: body.toothRefs,
        shade: body.shade,
        dueAt: body.dueAt ? new Date(body.dueAt) : null,
        cost: body.cost ?? 0,
        notes: body.notes,
      },
    });
    await this.timeline.add(
      body.patientId,
      'TREATMENT',
      `Lab work sent: ${workType.toLowerCase().replace('_', ' ')} to ${body.labName}`,
      body.toothRefs ? `Tooth ${body.toothRefs}` : undefined,
      'LabWork',
      labWork.id,
    );
    return labWork;
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: string; dueAt?: string; cost?: number; notes?: string },
  ) {
    if (body.status && !STATUSES.includes(body.status)) {
      throw new BadRequestException('Invalid status');
    }
    const labWork = await this.prisma.labWork.update({
      where: { id },
      data: {
        status: body.status,
        dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
        cost: body.cost,
        notes: body.notes,
        receivedAt: body.status === 'RECEIVED' ? new Date() : undefined,
      },
    });
    if (body.status) {
      await this.timeline.add(
        labWork.patientId,
        'TREATMENT',
        `Lab work ${body.status.toLowerCase()}: ${labWork.workType.toLowerCase().replace('_', ' ')} (${labWork.labName})`,
        undefined,
        'LabWork',
        labWork.id,
      );
    }
    return labWork;
  }
}
