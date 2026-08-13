import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenancy } from './tenancy';

/**
 * Models that carry a clinicId column, discovered from the schema itself so a
 * newly added tenant model is scoped automatically — forgetting is impossible.
 */
const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'clinicId'))
    .map((m) => m.name),
);

/** Actions whose args.where is a plain filter we can merge clinicId into. */
const FILTER_ACTIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
]);

/**
 * Tenant-scoped Prisma. Every query on a tenant model is automatically
 * confined to the caller's clinic (from the AsyncLocalStorage tenant
 * context) — controllers never write `clinicId` by hand:
 *  - create/createMany  -> clinicId injected into data
 *  - finds/count/agg/…  -> clinicId merged into where
 *  - findUnique(OrThrow)-> rewritten to findFirst(OrThrow) + scope
 *  - update/delete      -> ownership pre-checked (404 when not this clinic's)
 *  - Setting            -> `{where:{key}}` rewritten to the composite
 *                          `[clinicId, key]` so existing call sites survive
 * No context and no bypass -> throw. SUPER_ADMIN/privileged code bypasses.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    this.$use((params, next) => this.scopeToTenant(params, next));
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  private async scopeToTenant(
    params: Prisma.MiddlewareParams,
    next: (params: Prisma.MiddlewareParams) => Promise<unknown>,
  ): Promise<unknown> {
    const model = params.model as string | undefined;
    if (!model || !TENANT_MODELS.has(model)) return next(params);

    const store = tenancy.get();
    if (store?.bypass) return next(params);
    const clinicId = store?.clinicId;
    if (clinicId == null) {
      // Deny-by-default: never silently return cross-tenant data.
      throw new Error(
        `Tenant context missing for ${model}.${params.action} — wrap request-less code in tenancy.runAs()/runPrivileged()`,
      );
    }

    const args: Record<string, any> = (params.args ?? {}) as Record<string, any>;
    params.args = args;

    switch (params.action) {
      case 'create':
        args.data = { ...(args.data ?? {}), clinicId };
        break;

      case 'createMany':
        if (Array.isArray(args.data)) args.data = args.data.map((d: object) => ({ ...d, clinicId }));
        else if (args.data) args.data = { ...args.data, clinicId };
        break;

      case 'upsert':
        if (model === 'Setting') {
          // Rewrite legacy `{where:{key}}` to the composite tenant key.
          const key = args.where?.key ?? args.where?.clinicId_key?.key;
          args.where = { clinicId_key: { clinicId, key } };
          args.create = { ...(args.create ?? {}), clinicId };
          break;
        }
        // No other tenant model upserts by unique id today; fail loud rather
        // than risk updating another clinic's row.
        throw new Error(`upsert on tenant model ${model} is not tenant-safe — use update/create explicitly`);

      case 'findUnique':
      case 'findUniqueOrThrow':
        params.action = params.action === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
        args.where = { ...flattenUniqueWhere(args.where), clinicId };
        break;

      case 'update':
      case 'delete': {
        if (model === 'Setting' && args.where?.key !== undefined) {
          args.where = { clinicId_key: { clinicId, key: args.where.key } };
          break; // composite key already carries the clinic
        }
        // Unique-where write: verify the row belongs to this clinic first.
        // The check re-enters this middleware as a scoped findFirst.
        const delegate = (this as any)[model.charAt(0).toLowerCase() + model.slice(1)];
        const owned = await delegate.findFirst({
          where: flattenUniqueWhere(args.where),
          select: { id: true },
        });
        if (!owned) {
          throw new Prisma.PrismaClientKnownRequestError(
            `No ${model} found for this clinic.`,
            { code: 'P2025', clientVersion: Prisma.prismaVersion.client },
          );
        }
        break;
      }

      default:
        if (FILTER_ACTIONS.has(params.action)) {
          args.where = { AND: [{ clinicId }, args.where ?? {}] };
        }
        break;
    }
    return next(params);
  }
}

/**
 * findUnique-style where ({id} or composite {clinicId_code:{…}}) flattened to
 * a plain findFirst filter.
 */
function flattenUniqueWhere(where: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v && typeof v === 'object' && !(v instanceof Date) && k.includes('_')) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}
