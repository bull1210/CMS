import { Controller, Get, Param, Post, Res } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Response } from 'express';
import archiver from 'archiver';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

const backupDir = () => join(process.cwd(), process.env.BACKUP_DIR ?? './storage/backups');
const uploadDir = () => join(process.cwd(), process.env.UPLOAD_DIR ?? './storage/uploads');
const dbFile = () => {
  const url = process.env.DATABASE_URL ?? 'file:./clinic.db';
  return join(process.cwd(), 'prisma', url.replace('file:', ''));
};

/**
 * Backup = one zip containing the SQLite DB + all uploaded attachments.
 * Restore: stop the server, unzip over server/prisma + server/storage/uploads,
 * restart (see server/RESTORE.md).
 *
 * Multi-tenant: the zip contains EVERY clinic's data, so this is platform
 * (SUPER_ADMIN) territory. Per-clinic export is a future feature.
 */
@Roles('SUPER_ADMIN')
@Controller('backup')
export class BackupController {
  constructor(private audit: AuditService) {}

  // Daily automatic backup at 01:30.
  @Cron('30 1 * * *')
  async nightly() {
    await this.createBackup();
  }

  @Get()
  list() {
    const dir = backupDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.zip'))
      .map((f) => {
        const s = statSync(join(dir, f));
        return { name: f, size: s.size, createdAt: s.mtime };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  @Post()
  async create(@CurrentUser() user: AuthUser) {
    const file = await this.createBackup();
    await this.audit.log(user.sub, 'BACKUP', 'System', undefined, file);
    return { file };
  }

  @Get(':name/download')
  download(@Param('name') name: string, @Res() res: Response) {
    // basename() blocks path traversal.
    const file = join(backupDir(), basename(name));
    if (!existsSync(file)) return res.status(404).json({ message: 'Not found' });
    return res.download(file);
  }

  private createBackup(): Promise<string> {
    const dir = backupDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `clinic-backup-${stamp}.zip`;
    const out = createWriteStream(join(dir, name));
    const archive = archiver('zip', { zlib: { level: 9 } });
    return new Promise((resolve, reject) => {
      out.on('close', () => resolve(name));
      archive.on('error', reject);
      archive.pipe(out);
      if (existsSync(dbFile())) archive.file(dbFile(), { name: `prisma/${basename(dbFile())}` });
      if (existsSync(uploadDir())) archive.directory(uploadDir(), 'storage/uploads');
      archive.finalize();
    });
  }
}
