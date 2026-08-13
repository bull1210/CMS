import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { seedClinicDefaults } from '../../core/clinic-defaults';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

const PLANS = ['TRIAL', 'STANDARD', 'SUSPENDED'];

/**
 * Aatmam platform console: clinic lifecycle only. SUPER_ADMIN requests run
 * with tenant scoping bypassed, so this controller sets clinicId explicitly
 * on everything it touches — it is the ONLY module that may.
 */
@Roles('SUPER_ADMIN')
@Controller('platform')
export class PlatformController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get('clinics')
  async list() {
    const clinics = await this.prisma.clinic.findMany({ orderBy: { createdAt: 'asc' } });
    // Light per-clinic counts for the console list.
    const [users, patients] = await Promise.all([
      this.prisma.user.groupBy({ by: ['clinicId'], _count: true, where: { clinicId: { not: null } } }),
      this.prisma.patient.groupBy({ by: ['clinicId'], _count: true }),
    ]);
    const usersBy = new Map(users.map((r) => [r.clinicId, r._count]));
    const patientsBy = new Map(patients.map((r) => [r.clinicId, r._count]));
    return clinics.map((c) => ({
      ...c,
      userCount: usersBy.get(c.id) ?? 0,
      patientCount: patientsBy.get(c.id) ?? 0,
    }));
  }

  @Post('clinics')
  async create(
    @CurrentUser() actor: AuthUser,
    @Body()
    body: {
      name: string;
      slug?: string;
      phone?: string;
      address?: string;
      adminName: string;
      adminEmail: string;
      adminPassword: string;
    },
  ) {
    if (!body?.name || !body?.adminName || !body?.adminEmail || !body?.adminPassword) {
      throw new BadRequestException('name, adminName, adminEmail and adminPassword are required');
    }
    const slug = (body.slug || body.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!slug) throw new BadRequestException('Could not derive a slug from the clinic name');

    const clinic = await this.prisma.clinic.create({
      data: { name: body.name, slug, phone: body.phone, address: body.address },
    });
    await seedClinicDefaults(this.prisma as PrismaClient, clinic.id, {
      'clinic.name': body.name,
      'clinic.phone': body.phone ?? '',
      'clinic.address': body.address ?? '',
    });
    const admin = await this.prisma.user.create({
      data: {
        clinicId: clinic.id,
        name: body.adminName,
        email: body.adminEmail.toLowerCase(),
        role: 'ADMIN',
        passwordHash: await bcrypt.hash(body.adminPassword, 10),
      },
      select: { id: true, name: true, email: true, role: true },
    });
    await this.audit.log(actor.sub, 'CREATE', 'Clinic', clinic.id, `${clinic.name} (${slug})`);
    return { ...clinic, admin };
  }

  @Put('clinics/:id')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; phone?: string; address?: string; active?: boolean; plan?: string },
  ) {
    if (body.plan && !PLANS.includes(body.plan)) throw new BadRequestException('Invalid plan');
    const clinic = await this.prisma.clinic.update({
      where: { id },
      data: {
        name: body.name,
        phone: body.phone,
        address: body.address,
        active: body.active,
        plan: body.plan,
      },
    });
    await this.audit.log(
      actor.sub,
      'UPDATE',
      'Clinic',
      id,
      body.active === false ? 'deactivated' : body.active === true ? 'activated' : 'updated',
    );
    return clinic;
  }
}
