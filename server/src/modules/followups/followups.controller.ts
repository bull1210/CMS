import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

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
    @CurrentUser() user: AuthUser,
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
    const userRow = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const creatorName = userRow?.name || `Assistant`;

    await this.timeline.add(
      body.patientId,
      'FOLLOW_UP',
      `Follow-up scheduled${fu.procedure ? `: ${fu.procedure.name}` : ''} by ${creatorName}`,
      body.note,
      'FollowUp',
      fu.id,
    );
    return fu;
  }

  @Put(':id/status')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number, 
    @Body() body: { status: string; resolution?: string }
  ) {
    if (!STATUSES.includes(body?.status)) throw new BadRequestException('Invalid status');
    
    const existing = await this.prisma.followUp.findUnique({ where: { id } });
    if (!existing) throw new BadRequestException('Followup not found');

    let newNote = existing.note;
    if (body.resolution) {
      const resText = `Resolved: ${body.resolution}`;
      newNote = newNote ? `${newNote}\n${resText}` : resText;
    }

    const fu = await this.prisma.followUp.update({
      where: { id },
      data: { status: body.status, note: newNote },
    });
    
    const userRow = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const updaterName = userRow?.name || `Assistant`;

    await this.timeline.add(
      fu.patientId,
      'FOLLOW_UP',
      `Follow-up ${body.status.toLowerCase()} by ${updaterName}`,
      body.resolution || undefined,
      'FollowUp',
      id,
    );
    return fu;
  }
}
