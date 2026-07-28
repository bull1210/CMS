import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

const CATEGORIES = ['CONSUMABLE', 'MEDICINE', 'INSTRUMENT', 'LAB_MATERIAL', 'OTHER'];
const TXN_REASONS = ['RECEIVE', 'CONSUME', 'ADJUST', 'EXPIRED'];

interface ItemInput {
  name: string;
  category?: string;
  unit?: string;
  reorderLevel?: number;
  costPerUnit?: number;
  expiryDate?: string;
  active?: boolean;
}

@Controller('inventory')
export class InventoryController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  async list(@Query('all') all?: string) {
    const items = await this.prisma.inventoryItem.findMany({
      where: all === '1' ? {} : { active: true },
      orderBy: { name: 'asc' },
    });
    return items.map((i) => ({ ...i, low: i.stockQty <= i.reorderLevel }));
  }

  @Get(':id/txns')
  txns(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.stockTxn.findMany({
      where: { itemId: id },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() body: ItemInput & { stockQty?: number }) {
    if (!body?.name) throw new BadRequestException('name is required');
    const item = await this.prisma.inventoryItem.create({
      data: {
        name: body.name,
        category: body.category && CATEGORIES.includes(body.category) ? body.category : 'CONSUMABLE',
        unit: body.unit || 'pcs',
        stockQty: body.stockQty ?? 0,
        reorderLevel: body.reorderLevel ?? 0,
        costPerUnit: body.costPerUnit ?? 0,
        expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
      },
    });
    if (item.stockQty > 0) {
      await this.prisma.stockTxn.create({
        data: { itemId: item.id, delta: item.stockQty, reason: 'RECEIVE', note: 'Opening stock', createdById: user.sub },
      });
    }
    await this.audit.log(user.sub, 'CREATE', 'InventoryItem', item.id, item.name);
    return item;
  }

  @Roles('DOCTOR', 'ADMIN')
  @Put(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ItemInput,
  ) {
    if (body.category && !CATEGORIES.includes(body.category)) {
      throw new BadRequestException('Invalid category');
    }
    const item = await this.prisma.inventoryItem.update({
      where: { id },
      data: {
        name: body.name,
        category: body.category,
        unit: body.unit,
        reorderLevel: body.reorderLevel,
        costPerUnit: body.costPerUnit,
        expiryDate: body.expiryDate !== undefined ? (body.expiryDate ? new Date(body.expiryDate) : null) : undefined,
        active: body.active,
      },
    });
    await this.audit.log(user.sub, 'UPDATE', 'InventoryItem', item.id, item.name);
    return item;
  }

  /** Stock in/out. Any signed-in role — the front desk restocks and consumes too. */
  @Post(':id/adjust')
  async adjust(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { delta: number; reason?: string; note?: string },
  ) {
    const delta = Number(body?.delta);
    if (!delta || Number.isNaN(delta)) throw new BadRequestException('delta must be a non-zero number');
    const reason = body.reason && TXN_REASONS.includes(body.reason) ? body.reason : delta > 0 ? 'RECEIVE' : 'CONSUME';

    const item = await this.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
    const newQty = Math.round((item.stockQty + delta) * 100) / 100;
    if (newQty < 0) throw new BadRequestException(`Only ${item.stockQty} ${item.unit} in stock`);

    const [updated] = await this.prisma.$transaction([
      this.prisma.inventoryItem.update({ where: { id }, data: { stockQty: newQty } }),
      this.prisma.stockTxn.create({
        data: { itemId: id, delta, reason, note: body.note, createdById: user.sub },
      }),
    ]);
    await this.audit.log(user.sub, 'UPDATE', 'InventoryItem', id, `${reason} ${delta} ${item.unit}`);
    return { ...updated, low: updated.stockQty <= updated.reorderLevel };
  }
}
