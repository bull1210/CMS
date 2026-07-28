import { Body, Controller, Get, Put } from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

/**
 * Key-value clinic configuration. Known keys:
 *  clinic.name, clinic.doctor, clinic.address, clinic.phone,
 *  billing.taxPercent, billing.currency,
 *  reminders.offsets ("3d,1d,2h"),
 *  messaging.webhookUrl (SMS/WhatsApp gateway endpoint)
 */
@Controller('settings')
export class SettingsController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  async all() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Roles('ADMIN')
  @Put()
  async update(@CurrentUser() user: AuthUser, @Body() body: Record<string, string>) {
    for (const [key, value] of Object.entries(body ?? {})) {
      await this.prisma.setting.upsert({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      });
    }
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, Object.keys(body ?? {}).join(','));
    return this.all();
  }
}
