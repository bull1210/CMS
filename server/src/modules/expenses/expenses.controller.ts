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
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

const CATEGORIES = ['RENT', 'SALARY', 'LAB', 'MATERIALS', 'EQUIPMENT', 'UTILITIES', 'MARKETING', 'OTHER'];
const METHODS = ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];

@Roles('DOCTOR', 'ADMIN')
@Controller('expenses')
export class ExpensesController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Get()
  async list(@Query('from') from?: string, @Query('to') to?: string) {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 30 * 86400_000);
    const items = await this.prisma.expense.findMany({
      where: { date: { gte: start, lte: end } },
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
    return { items, total: items.reduce((s, e) => s + e.amount, 0), from: start, to: end };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @Body() body: { date?: string; category?: string; description: string; amount: number; method?: string },
  ) {
    const amount = Number(body?.amount);
    if (!body?.description || !amount || amount <= 0) {
      throw new BadRequestException('description and a positive amount are required');
    }
    const expense = await this.prisma.expense.create({
      data: {
        date: body.date ? new Date(body.date) : new Date(),
        category: body.category && CATEGORIES.includes(body.category) ? body.category : 'OTHER',
        description: body.description,
        amount,
        method: body.method && METHODS.includes(body.method) ? body.method : 'CASH',
        createdById: user.sub,
      },
    });
    await this.audit.log(user.sub, 'CREATE', 'Expense', expense.id, `${expense.category} ₹${amount}`);
    return expense;
  }

  @Roles('ADMIN')
  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const expense = await this.prisma.expense.delete({ where: { id } });
    await this.audit.log(user.sub, 'DELETE', 'Expense', id, expense.description);
    return { ok: true };
  }
}
