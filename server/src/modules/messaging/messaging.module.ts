import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { RemindersScheduler } from './reminders.scheduler';

@Module({
  imports: [AppointmentsModule],
  controllers: [MessagingController],
  providers: [MessagingService, RemindersScheduler],
  exports: [MessagingService],
})
export class MessagingModule {}
