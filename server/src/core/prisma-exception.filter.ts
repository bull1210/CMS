import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Maps known Prisma errors to meaningful HTTP responses instead of opaque 500s:
 *   P2002 unique violation  -> 409 ("already exists")
 *   P2025 record not found  -> 404
 *   P2003 FK violation      -> 400 (referencing a non-existent record)
 */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, { status: number; message: string }> = {
      P2002: {
        status: HttpStatus.CONFLICT,
        message: `Already exists — ${String((exception.meta?.target as string[] | string) ?? 'unique field')} must be unique`,
      },
      P2025: { status: HttpStatus.NOT_FOUND, message: 'Record not found' },
      P2003: { status: HttpStatus.BAD_REQUEST, message: 'Referenced record does not exist' },
    };
    const mapped = map[exception.code] ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Database error',
    };
    res.status(mapped.status).json({ statusCode: mapped.status, message: mapped.message });
  }
}
