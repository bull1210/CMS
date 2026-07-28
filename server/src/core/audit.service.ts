import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(userId: number | null, action: string, entity: string, entityId?: number, detail?: string) {
    return this.prisma.auditLog
      .create({ data: { userId: userId ?? undefined, action, entity, entityId, detail } })
      .catch(() => undefined); // auditing must never break the main flow
  }
}
