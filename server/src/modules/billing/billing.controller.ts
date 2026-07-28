import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { BillingService, InvoiceInput, PaymentInput } from './billing.service';
import { AuditService } from '../../core/audit.service';
import { AuthUser, CurrentUser, Roles } from '../../core/auth.guard';

@Controller('billing')
export class BillingController {
  constructor(
    private billing: BillingService,
    private audit: AuditService,
  ) {}

  @Get('invoices')
  listInvoices(@Query('patientId') patientId?: string, @Query('status') status?: string) {
    return this.billing.listInvoices(patientId ? Number(patientId) : undefined, status);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id', ParseIntPipe) id: number) {
    return this.billing.getInvoice(id);
  }

  @Post('invoices')
  async createInvoice(@CurrentUser() user: AuthUser, @Body() body: InvoiceInput) {
    const invoice = await this.billing.createInvoice(body);
    await this.audit.log(user.sub, 'CREATE', 'Invoice', invoice.id, invoice.number);
    return invoice;
  }

  @Roles('DOCTOR', 'ADMIN')
  @Post('invoices/:id/void')
  async voidInvoice(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const invoice = await this.billing.voidInvoice(id);
    await this.audit.log(user.sub, 'VOID', 'Invoice', id);
    return invoice;
  }

  @Get('payments')
  listPayments(@Query('patientId') patientId?: string) {
    return this.billing.listPayments(patientId ? Number(patientId) : undefined);
  }

  @Post('payments')
  async recordPayment(@CurrentUser() user: AuthUser, @Body() body: PaymentInput) {
    const payment = await this.billing.recordPayment(body);
    await this.audit.log(user.sub, 'CREATE', 'Payment', payment.id, String(payment.amount));
    return payment;
  }

  @Get('outstanding')
  outstanding() {
    return this.billing.outstanding();
  }
}
