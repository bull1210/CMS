import { Body, Controller, Get, Put, Post, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser, Roles, Public } from '../../core/auth.guard';

const uploadDir = () => process.env.UPLOAD_DIR ?? './storage/uploads';
const storage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = join(process.cwd(), uploadDir());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeExt = extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `logo-${Date.now()}${safeExt}`);
  },
});

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

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
    private timeline: TimelineService,
  ) {}

  @Get()
  async all() {
    const rows = await this.prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @Public()
  @Get('public')
  async getPublicSettings() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['clinic.name', 'clinic.tagline', 'clinic.logo', 'clinic.theme'] } }
    });
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

  @Roles('ADMIN', 'DOCTOR', 'ASSISTANT')
  @Put('closures')
  async updateClosures(@CurrentUser() user: AuthUser, @Body() body: { closures: string }) {
    const oldRow = await this.prisma.setting.findUnique({ where: { key: 'clinic.closures' } });
    let oldClosures: Record<string, string> = {};
    let newClosures: Record<string, string> = {};
    try { if (oldRow?.value) oldClosures = JSON.parse(oldRow.value); } catch (e) {}
    try { newClosures = JSON.parse(body.closures); } catch (e) {}

    const newlyClosedDates = Object.keys(newClosures).filter((dateStr) => !oldClosures[dateStr]);

    for (const dateStr of newlyClosedDates) {
      const minDate = new Date(`${dateStr}T00:00:00`);
      const maxDate = new Date(`${dateStr}T23:59:59`);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          startsAt: { gte: minDate, lte: maxDate },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'WAITING'] },
        },
      });

      for (const appt of appointments) {
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            notes: (appt.notes ? appt.notes + '\n\n' : '') + `System: Cancelled due to clinic closure (${newClosures[dateStr]}).`,
          },
        });

        await this.prisma.followUp.create({
          data: {
            patientId: appt.patientId,
            dueDate: appt.startsAt,
            status: 'PENDING',
            note: `RESCHEDULE: Clinic closed on ${dateStr} (${newClosures[dateStr]}). Original appt ID: ${appt.id}, Doctor ID: ${appt.doctorId || ''}`,
          },
        });

        await this.timeline.add(
          appt.patientId,
          'APPOINTMENT',
          `Appointment cancelled: Cancelled by clinic due to closure (${newClosures[dateStr]})`,
          undefined,
          'Appointment',
          appt.id,
        );
      }
    }

    await this.prisma.setting.upsert({
      where: { key: 'clinic.closures' },
      update: { value: body.closures },
      create: { key: 'clinic.closures', value: body.closures },
    });
    
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, 'clinic.closures');
    return { success: true };
  }
  @Put('doctor-closures')
  async updateDoctorClosures(@CurrentUser() user: AuthUser, @Body() body: { doctorId: number; closures: string }) {
    const oldRow = await this.prisma.setting.findUnique({ where: { key: 'doctor.closures' } });
    let docClosures: Record<string, Record<string, string>> = {};
    try { if (oldRow?.value) docClosures = JSON.parse(oldRow.value); } catch (e) {}

    const oldDoctorClosures = docClosures[body.doctorId] || {};
    let newDoctorClosures: Record<string, string> = {};
    try { newDoctorClosures = JSON.parse(body.closures); } catch (e) {}

    const newlyClosedDates = Object.keys(newDoctorClosures).filter((dateStr) => !oldDoctorClosures[dateStr]);

    for (const dateStr of newlyClosedDates) {
      const minDate = new Date(`${dateStr}T00:00:00`);
      const maxDate = new Date(`${dateStr}T23:59:59`);

      const appointments = await this.prisma.appointment.findMany({
        where: {
          startsAt: { gte: minDate, lte: maxDate },
          status: { in: ['SCHEDULED', 'CONFIRMED', 'WAITING'] },
          doctorId: body.doctorId,
        },
      });

      for (const appt of appointments) {
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: {
            status: 'CANCELLED',
            notes: (appt.notes ? appt.notes + '\n\n' : '') + `System: Cancelled due to doctor unavailability (${newDoctorClosures[dateStr]}).`,
          },
        });

        await this.prisma.followUp.create({
          data: {
            patientId: appt.patientId,
            dueDate: appt.startsAt,
            status: 'PENDING',
            note: `RESCHEDULE: Doctor unavailable on ${dateStr} (${newDoctorClosures[dateStr]}). Original appt ID: ${appt.id}, Doctor ID: ${appt.doctorId || ''}`,
          },
        });

        await this.timeline.add(
          appt.patientId,
          'APPOINTMENT',
          `Appointment cancelled: Cancelled by clinic due to doctor unavailability (${newDoctorClosures[dateStr]})`,
          undefined,
          'Appointment',
          appt.id,
        );
      }
    }

    docClosures[body.doctorId] = newDoctorClosures;
    const finalValue = JSON.stringify(docClosures);

    await this.prisma.setting.upsert({
      where: { key: 'doctor.closures' },
      update: { value: finalValue },
      create: { key: 'doctor.closures', value: finalValue },
    });
    
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, 'doctor.closures');
    return { success: true };
  }


  @Roles('ADMIN')
  @Post('logo')
  @UseInterceptors(FileInterceptor('file', { storage, limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadLogo(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required');
    if (
      !ALLOWED_MIME.includes(file.mimetype) ||
      !ALLOWED_EXT.includes(extname(file.originalname).toLowerCase())
    ) {
      throw new BadRequestException('Only JPG, PNG and WEBP files are allowed');
    }
    const path = `/files/${file.filename}`;
    await this.prisma.setting.upsert({
      where: { key: 'clinic.logo' },
      update: { value: path },
      create: { key: 'clinic.logo', value: path },
    });
    await this.audit.log(user.sub, 'UPDATE', 'Settings', undefined, 'clinic.logo');
    return { path };
  }
}
