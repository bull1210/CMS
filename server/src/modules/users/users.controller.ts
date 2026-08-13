import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CLINIC_ROLES, CurrentUser, Roles } from '../../core/auth.guard';

const publicUser = { id: true, name: true, email: true, role: true, active: true, createdAt: true };

@Controller('users')
export class UsersController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.prisma.user.findMany({ select: publicUser, orderBy: { name: 'asc' } });
  }

  @Roles('ADMIN')
  @Post()
  async create(
    @CurrentUser() actor: AuthUser,
    @Body() body: { name: string; email: string; password: string; role: string },
  ) {
    if (!body?.name || !body?.email || !body?.password) {
      throw new BadRequestException('name, email and password are required');
    }
    // Clinic admins may only create clinic staff — SUPER_ADMIN is platform-only.
    if (!CLINIC_ROLES.includes(body.role as never)) throw new BadRequestException('Invalid role');
    const user = await this.prisma.user.create({
      data: {
        name: body.name,
        email: body.email.toLowerCase(),
        role: body.role,
        passwordHash: await bcrypt.hash(body.password, 10),
      },
      select: publicUser,
    });
    await this.audit.log(actor.sub, 'CREATE', 'User', user.id, user.email);
    return user;
  }

  @Roles('ADMIN')
  @Put(':id')
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; email?: string; password?: string; role?: string; active?: boolean },
  ) {
    if (body.role && !CLINIC_ROLES.includes(body.role as never)) throw new BadRequestException('Invalid role');
    const data: Record<string, unknown> = {
      name: body.name,
      email: body.email?.toLowerCase(),
      role: body.role,
      active: body.active,
    };
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);
    const user = await this.prisma.user.update({ where: { id }, data, select: publicUser });
    await this.audit.log(actor.sub, 'UPDATE', 'User', id);
    return user;
  }

  @Roles('ADMIN')
  @Delete(':id')
  async deactivate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    if (actor.sub === id) throw new BadRequestException('Cannot deactivate yourself');
    const user = await this.prisma.user.update({
      where: { id },
      data: { active: false },
      select: publicUser,
    });
    await this.audit.log(actor.sub, 'DEACTIVATE', 'User', id);
    return user;
  }
}
