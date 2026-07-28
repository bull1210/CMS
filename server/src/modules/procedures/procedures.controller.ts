import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { Roles } from '../../core/auth.guard';

interface ProcedureInput {
  name: string;
  description?: string;
  cost?: number;
  followUpId?: number | null;
  followUpDays?: number | null;
  active?: boolean;
}

@Controller('procedures')
export class ProceduresController {
  constructor(private prisma: PrismaService) {}

  @Get()
  list() {
    return this.prisma.procedure.findMany({
      include: { followUp: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  create(@Body() body: ProcedureInput) {
    if (!body?.name) throw new BadRequestException('name is required');
    return this.prisma.procedure.create({ data: clean(body) as never });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<ProcedureInput>) {
    if (body.followUpId === id) throw new BadRequestException('A procedure cannot follow itself');
    return this.prisma.procedure.update({ where: { id }, data: clean(body) as never });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Delete(':id')
  deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.procedure.update({ where: { id }, data: { active: false } });
  }
}

function clean(body: Partial<ProcedureInput>) {
  return {
    name: body.name,
    description: body.description,
    cost: body.cost !== undefined ? Number(body.cost) : undefined,
    followUpId: body.followUpId === undefined ? undefined : body.followUpId,
    followUpDays: body.followUpDays === undefined ? undefined : body.followUpDays,
    active: body.active,
  };
}
