import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { PatientsService, PatientInput } from './patients.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser } from '../../core/auth.guard';

@Controller('patients')
export class PatientsController {
  constructor(
    private patients: PatientsService,
    private audit: AuditService,
  ) {}

  @Get()
  list(@Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.patients.list(q, Number(page) || 1, Math.min(Number(pageSize) || 25, 100));
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.patients.get(id);
  }

  @Get(':id/summary')
  summary(@Param('id', ParseIntPipe) id: number) {
    return this.patients.summary(id);
  }

  @Get(':id/timeline')
  timeline(@Param('id', ParseIntPipe) id: number) {
    return this.patients.timelineFor(id);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: PatientInput) {
    const patient = await this.patients.create(body);
    await this.audit.log(user.sub, 'CREATE', 'Patient', patient.id, patient.name);
    return patient;
  }

  @Put(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<PatientInput>,
  ) {
    const patient = await this.patients.update(id, body);
    await this.audit.log(user.sub, 'UPDATE', 'Patient', id);
    return patient;
  }
}
