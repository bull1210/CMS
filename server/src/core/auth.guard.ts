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

export const ROLES = { ADMIN: 'ADMIN', DOCTOR: 'DOCTOR', ASSISTANT: 'ASSISTANT' } as const;
export type Role = keyof typeof ROLES;

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

    // A token must die with its user: deactivating staff revokes access
    // immediately, not at JWT expiry. (Single indexed lookup — cheap at this scale.)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { active: true, role: true },
    });
    if (!user?.active) throw new UnauthorizedException('Account deactivated');
    payload.role = user.role as Role; // role changes take effect immediately too
    req.user = payload;

    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(payload.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
