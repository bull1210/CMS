import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { tenancy } from './tenancy';

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN', // Aatmam platform staff — /platform only, no clinic data
  ADMIN: 'ADMIN',
  DOCTOR: 'DOCTOR',
  ASSISTANT: 'ASSISTANT',
} as const;
export type Role = keyof typeof ROLES;

/** Roles a clinic may assign to its own staff (SUPER_ADMIN is platform-only). */
export const CLINIC_ROLES: Role[] = ['ADMIN', 'DOCTOR', 'ASSISTANT'];

export const Public = () => SetMetadata('isPublic', true);
/** Restrict a handler to specific roles. Without it, any authenticated user may call it. */
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user;
});

export interface AuthUser {
  sub: number;
  name: string;
  role: Role;
  clinicId: number | null; // null = SUPER_ADMIN
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing token');

    let payload: AuthUser;
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // A token must die with its user — and with its clinic. Deactivating staff
    // or suspending a whole clinic revokes access on the very next request,
    // not at JWT expiry. (Single indexed lookup — cheap at this scale.)
    const user = await tenancy.runPrivileged(() =>
      this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { active: true, role: true, clinicId: true, clinic: { select: { active: true } } },
      }),
    );
    if (!user?.active) throw new UnauthorizedException('Account deactivated');
    if (user.clinicId != null && !user.clinic?.active) {
      throw new UnauthorizedException('This clinic is deactivated — contact Aatmam support');
    }
    payload.role = user.role as Role; // role changes take effect immediately too
    payload.clinicId = user.clinicId;
    req.user = payload;

    // Seed the tenant context every downstream Prisma query is scoped by.
    if (payload.role === 'SUPER_ADMIN') tenancy.set({ bypass: true });
    else if (payload.clinicId != null) tenancy.set({ clinicId: payload.clinicId });
    else throw new UnauthorizedException('Account is not attached to a clinic');

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    // SUPER_ADMIN is deny-by-default on clinic routes: platform staff reach
    // clinic data only through features built for it, never implicitly.
    if (payload.role === 'SUPER_ADMIN' && !roles?.includes('SUPER_ADMIN')) {
      throw new ForbiddenException('Platform accounts cannot access clinic data');
    }
    if (roles?.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
