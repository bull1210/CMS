import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import { Public } from '../../core/auth.guard';

const uploadDir = () => process.env.UPLOAD_DIR ?? './storage/uploads';

/**
 * Auth-checked file serving (replaces the old world-readable static mount —
 * an X-ray URL must not leak across clinics or to the public internet).
 *
 * Marked @Public because <img>/<a> tags cannot send an Authorization header;
 * the JWT arrives as ?token= instead (or the header, when fetch is used) and
 * is verified manually. The path's clinic folder must match the caller's
 * clinic — SUPER_ADMIN included: platform staff have no implicit read access
 * to clinical files.
 *
 * Exception: `logo-*` files are clinic branding shown on the login screen
 * before any token exists — those are public by design and never contain PHI.
 */
@Public()
@Controller('files')
export class FilesController {
  constructor(private jwt: JwtService) {}

  @Get(':dir/:name')
  async serve(
    @Param('dir') dir: string,
    @Param('name') name: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // basename() blocks path traversal.
    const safeDir = basename(dir);
    const safeName = basename(name);
    const path = join(process.cwd(), uploadDir(), safeDir, safeName);
    if (!existsSync(path)) throw new NotFoundException('File not found');

    if (!safeName.startsWith('logo-')) {
      const header = req.headers['authorization'];
      const raw = header?.startsWith('Bearer ') ? header.slice(7) : queryToken;
      if (!raw) throw new ForbiddenException('Missing token');
      let payload: { clinicId?: number | null };
      try {
        payload = await this.jwt.verifyAsync(raw);
      } catch {
        throw new ForbiddenException('Invalid or expired token');
      }
      if (`c${payload.clinicId}` !== safeDir) {
        throw new ForbiddenException('File belongs to another clinic');
      }
    }
    return res.sendFile(path);
  }
}
