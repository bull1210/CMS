import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { TreatmentsService, TreatmentInput } from './treatments.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

@Controller('treatments')
export class TreatmentsController {
  constructor(private treatments: TreatmentsService) {}

  @Get()
  list(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.treatments.list(patientId ? Number(patientId) : undefined, status);
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: TreatmentInput) {
    return this.treatments.create(user.sub, body);
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status: string; notes?: string },
  ) {
    return this.treatments.updateStatus(id, body.status, body.notes);
  }
}
