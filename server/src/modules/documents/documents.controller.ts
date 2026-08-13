import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

const CATEGORIES = ['XRAY', 'PRESCRIPTION', 'SCAN', 'LAB_REPORT', 'INSURANCE', 'CONSENT', 'OTHER'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
const uploadDir = () => process.env.UPLOAD_DIR ?? './storage/uploads';

// Local disk storage now; storedPath is a relative key so a future S3/Azure
// adapter only has to swap read/write, not the data model. Files live under a
// per-clinic folder (c<clinicId>/…) and are served by the auth-checked files
// controller — an X-ray URL must never be readable by another clinic.
// Multer runs after the AuthGuard, so req.user is available here.
const clinicDir = (req: unknown) => `c${(req as { user?: { clinicId?: number } }).user?.clinicId ?? 0}`;
const storage = diskStorage({
  destination: (req, _file, cb) => {
    const dir = join(process.cwd(), uploadDir(), clinicDir(req));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeExt = extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

@Controller('documents')
export class DocumentsController {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  @Get()
  list(@Query('patientId') patientId?: string, @Query('category') category?: string) {
    return this.prisma.document.findMany({
      where: {
        ...(patientId ? { patientId: Number(patientId) } : {}),
        ...(category ? { category } : {}),
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', { storage, limits: { fileSize: 25 * 1024 * 1024 } }),
  )
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { patientId: string; category?: string; notes?: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    // Check both the client-declared MIME and the actual extension: MIME headers
    // are trivially spoofable, so neither alone is enough.
    if (
      !ALLOWED_MIME.includes(file.mimetype) ||
      !ALLOWED_EXT.includes(extname(file.originalname).toLowerCase())
    ) {
      unlinkSync(file.path);
      throw new BadRequestException('Only JPG, PNG, WEBP and PDF files are allowed');
    }
    const patientId = Number(body.patientId);
    if (!patientId) {
      unlinkSync(file.path);
      throw new BadRequestException('patientId is required');
    }
    const category = body.category && CATEGORIES.includes(body.category) ? body.category : 'OTHER';
    const doc = await this.prisma.document.create({
      data: {
        patientId,
        category,
        filename: file.originalname,
        storedPath: `c${user.clinicId}/${file.filename}`,
        mimeType: file.mimetype,
        size: file.size,
        notes: body.notes,
        uploadedById: user.sub,
      },
    });
    await this.timeline.add(
      patientId,
      'DOCUMENT',
      `${category.replace('_', ' ')} uploaded: ${file.originalname}`,
      body.notes,
      'Document',
      doc.id,
    );
    return doc;
  }

  @Roles('DOCTOR', 'ADMIN')
  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const doc = await this.prisma.document.delete({ where: { id } });
    const path = join(process.cwd(), uploadDir(), doc.storedPath);
    if (existsSync(path)) unlinkSync(path);
    return { deleted: true };
  }
}
