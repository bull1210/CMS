import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PlansService, PlanInput } from './plans.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

@Controller('plans')
export class PlansController {
  constructor(private plans: PlansService) {}

  @Get()
  list(@Query('patientId') patientId?: string) {
    return this.plans.list(patientId ? Number(patientId) : undefined);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.plans.get(id);
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: PlanInput) {
    return this.plans.create(user.sub, body);
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id/status')
  setStatus(@Param('id', ParseIntPipe) id: number, @Body() body: { status: string }) {
    return this.plans.setStatus(id, body?.status);
  }
}
