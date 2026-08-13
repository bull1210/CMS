import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { tenancy } from '../../core/tenancy';

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

@Injectable()
export class AuthService {
  // Brute-force throttle: 5 failed attempts per email locks login for 15 minutes.
  // In-memory is fine — a single-process local server; restart clears it.
  private fails = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const key = (email ?? '').trim().toLowerCase();
    const entry = this.fails.get(key);
    if (entry && entry.lockedUntil > Date.now()) {
      const mins = Math.ceil((entry.lockedUntil - Date.now()) / 60_000);
      throw new UnauthorizedException(`Too many failed attempts — try again in ${mins} min`);
    }

    // Pre-auth code has no tenant context yet — the lookup runs privileged,
    // then the clinic id is stamped into the request store for audit rows.
    const user = await tenancy.runPrivileged(() =>
      this.prisma.user.findUnique({ where: { email: key }, include: { clinic: { select: { id: true, name: true, active: true } } } }),
    );
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      const next = { count: (entry?.count ?? 0) + 1, lockedUntil: 0 };
      if (next.count >= MAX_FAILS) {
        next.lockedUntil = Date.now() + LOCK_MS;
        next.count = 0;
      }
      this.fails.set(key, next);
      await tenancy.runPrivileged(() =>
        this.audit.log(user?.id ?? null, 'LOGIN_FAILED', 'User', user?.id, email),
      );
      throw new UnauthorizedException('Invalid credentials');
    }
    // A clinic user cannot sign in to a suspended clinic (same instant-lockout
    // rule the guard enforces on every later request).
    if (user.clinicId != null && !user.clinic?.active) {
      throw new UnauthorizedException('This clinic is deactivated — contact Aatmam support');
    }
    this.fails.delete(key);
    tenancy.set(user.clinicId != null ? { clinicId: user.clinicId } : { bypass: true });
    await this.audit.log(user.id, 'LOGIN', 'User', user.id);
    const token = await this.jwt.signAsync({
      sub: user.id,
      name: user.name,
      role: user.role,
      clinicId: user.clinicId,
    });
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        clinicId: user.clinicId,
        clinicName: user.clinic?.name ?? null,
      },
    };
  }

  async me(userId: number) {
    const user = await tenancy.runPrivileged(() =>
      this.prisma.user.findUnique({ where: { id: userId }, include: { clinic: { select: { name: true } } } }),
    );
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      clinicId: user.clinicId,
      clinicName: user.clinic?.name ?? null,
    };
  }
}
