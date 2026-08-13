import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request tenant context. An Express-level middleware creates an EMPTY
 * store for every request; the AuthGuard fills in `clinicId` (or `bypass` for
 * SUPER_ADMIN) once the caller is known — ALS stores are by-reference, so the
 * later mutation is visible to everything downstream, including the Prisma
 * scoping middleware in PrismaService.
 *
 * Deny-by-default: a query on a tenant model with neither `clinicId` nor
 * `bypass` set throws (see PrismaService) instead of returning cross-tenant
 * rows. Request-less code (schedulers, webhooks, bootstrap) must opt in
 * explicitly via runAs()/runPrivileged().
 */
export interface TenantStore {
  clinicId?: number;
  /** Skip tenant scoping entirely (SUPER_ADMIN, auth lookups, cross-clinic loops). */
  bypass?: boolean;
}

class TenancyContext {
  private als = new AsyncLocalStorage<TenantStore>();

  get(): TenantStore | undefined {
    return this.als.getStore();
  }

  /** Mutate the current request's store (no-op outside a store — never throws). */
  set(patch: TenantStore) {
    const store = this.als.getStore();
    if (store) Object.assign(store, patch);
  }

  // Prisma promises are lazy — the query fires on await, not on call. The
  // async wrapper awaits INSIDE the ALS scope so the store is still there
  // when the middleware runs; `als.run(store, fn)` alone would leak the query
  // execution outside the context.

  /** Run `fn` scoped to one clinic (schedulers, webhook fan-in). */
  runAs<T>(clinicId: number, fn: () => Promise<T> | T): Promise<T> {
    return this.als.run({ clinicId }, async () => await fn());
  }

  /** Run `fn` with tenant scoping disabled (auth lookups, platform code). */
  runPrivileged<T>(fn: () => Promise<T> | T): Promise<T> {
    return this.als.run({ bypass: true }, async () => await fn());
  }

  /** Express middleware: give every request an empty store to fill in later. */
  middleware = (_req: Request, _res: Response, next: NextFunction) => {
    this.als.run({}, next);
  };
}

export const tenancy = new TenancyContext();
