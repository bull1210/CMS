import { Controller, Get, Query } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';

/**
 * Global instant search across patients, diagnoses and procedures.
 * At the 50–1000 patient scale SQLite LIKE queries return in milliseconds.
 */
@Controller('search')
export class SearchController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async search(@Query('q') q?: string) {
    const term = (q ?? '').trim();
    if (term.length < 2) return { patients: [], diagnoses: [], procedures: [] };

    const [patients, diagnoses, procedures] = await Promise.all([
      this.prisma.patient.findMany({
        where: {
          OR: [
            { name: { contains: term } },
            { phone: { contains: term } },
            { code: { contains: term } },
            { email: { contains: term } },
          ],
        },
        select: { id: true, code: true, name: true, phone: true },
        take: 10,
      }),
      this.prisma.diagnosis.findMany({
        where: { diagnosis: { contains: term } },
        include: { patient: { select: { id: true, code: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.treatment.findMany({
        where: { procedure: { name: { contains: term } } },
        include: {
          patient: { select: { id: true, code: true, name: true } },
          procedure: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    return { patients, diagnoses, procedures };
  }
}
