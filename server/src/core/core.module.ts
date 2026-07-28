import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TimelineService } from './timeline.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [PrismaService, TimelineService, AuditService],
  exports: [PrismaService, TimelineService, AuditService],
})
export class CoreModule {}
