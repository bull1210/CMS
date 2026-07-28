import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { RiskService } from './risk.service';

@Module({
  controllers: [AppointmentsController],
  providers: [RiskService],
  exports: [RiskService],
})
export class AppointmentsModule {}
