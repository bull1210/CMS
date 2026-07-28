import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Append-only patient event stream. Every module records what happened here,
// which powers the timeline UI and gives future AI features a clean substrate.
@Injectable()
export class TimelineService {
  constructor(private prisma: PrismaService) {}

  add(
    patientId: number,
    type: string,
    title: string,
    detail?: string,
    refType?: string,
    refId?: number,
  ) {
    return this.prisma.timelineEvent.create({
      data: { patientId, type, title, detail, refType, refId },
    });
  }

  forPatient(patientId: number) {
    return this.prisma.timelineEvent.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
