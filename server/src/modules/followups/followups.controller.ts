import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { Roles } from '../../core/auth.guard';

const STATUSES = ['PENDING', 'BOOKED', 'DONE', 'DISMISSED'];

@Controller('followups')
export class FollowupsController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  @Get()
  list(@Query('status') status?: string, @Query('patientId') patientId?: string) {
    return this.prisma.followUp.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(patientId ? { patientId: Number(patientId) } : {}),
      },
      include: {
        patient: { select: { id: true, name: true, code: true, phone: true, whatsapp: true } },
        procedure: { select: { id: true, name: true, cost: true } },
        sourceTreatment: { include: { procedure: { select: { name: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /** Manual follow-up created by the doctor ("review in N days"). */
  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(
    @Body() body: { patientId: number; procedureId?: number; dueDate: string; note?: string },
  ) {
    if (!body?.patientId || !body?.dueDate) {
      throw new BadRequestException('patientId and dueDate are required');
    }
    const fu = await this.prisma.followUp.create({
      data: {
        patientId: body.patientId,
        procedureId: body.procedureId,
        dueDate: new Date(body.dueDate),
        note: body.note,
      },
      include: { procedure: true },
    });
    await this.timeline.add(
      body.patientId,
      'FOLLOW_UP',
      `Follow-up scheduled${fu.procedure ? `: ${fu.procedure.name}` : ''}`,
      body.note,
      'FollowUp',
      fu.id,
    );
    return fu;
  }

  @Put(':id/status')
  async setStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string }) {
    if (!STATUSES.includes(body?.status)) throw new BadRequestException('Invalid status');
    const fu = await this.prisma.followUp.update({
      where: { id },
      data: { status: body.status },
    });
    await this.timeline.add(
      fu.patientId,
      'FOLLOW_UP',
      `Follow-up ${body.status.toLowerCase()}`,
      undefined,
      'FollowUp',
      id,
    );
    return fu;
  }
}
