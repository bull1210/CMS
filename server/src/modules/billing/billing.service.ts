import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma.service';
import { TimelineService } from '../../core/timeline.service';

export interface InvoiceItemInput {
  description: string;
  qty?: number;
  unitPrice: number;
}
export interface InvoiceInput {
  patientId: number;
  treatmentId?: number;
  items: InvoiceItemInput[];
  discount?: number;
  taxPercent?: number;
  notes?: string;
}
export interface PaymentInput {
  patientId: number;
  invoiceId?: number;
  amount: number;
  method?: string;
  reference?: string;
  notes?: string;
}

const METHODS = ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private timeline: TimelineService,
  ) {}

  listInvoices(patientId?: number, status?: string) {
    return this.prisma.invoice.findMany({
      where: {
        ...(patientId ? { patientId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        items: true,
        payments: true,
        patient: { select: { id: true, name: true, code: true, phone: true, address: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getInvoice(id: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        patient: true,
        treatment: { include: { procedure: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
    return { ...invoice, paid, pending: Math.max(0, invoice.total - paid) };
  }

  async createInvoice(input: InvoiceInput) {
    if (!input?.patientId || !input?.items?.length) {
      throw new BadRequestException('patientId and at least one item are required');
    }
    const items = input.items.map((it) => {
      const qty = it.qty && it.qty > 0 ? Math.floor(it.qty) : 1;
      const unitPrice = Number(it.unitPrice) || 0;
      return { description: it.description, qty, unitPrice, amount: qty * unitPrice };
    });
    const subtotal = items.reduce((s, it) => s + it.amount, 0);
    const discount = Math.min(Number(input.discount) || 0, subtotal);
    const tax = Math.round((subtotal - discount) * ((Number(input.taxPercent) || 0) / 100) * 100) / 100;
    const total = subtotal - discount + tax;

    const year = new Date().getFullYear();
    // Numbers derive from a count, which can race under concurrent creates;
    // the unique constraint catches the collision and we retry with the next number.
    let invoice!: Prisma.InvoiceGetPayload<{ include: { items: true } }>;
    for (let attempt = 0; ; attempt++) {
      const count = await this.prisma.invoice.count();
      try {
        invoice = await this.prisma.invoice.create({
          data: {
            number: `INV-${year}-${String(count + 1 + attempt).padStart(4, '0')}`,
            patientId: input.patientId,
            treatmentId: input.treatmentId,
            subtotal,
            discount,
            tax,
            total,
            notes: input.notes,
            items: { create: items },
          },
          include: { items: true },
        });
        break;
      } catch (e) {
        const unique = (e as { code?: string }).code === 'P2002';
        if (!unique || attempt >= 3) throw e;
      }
    }
    await this.timeline.add(
      input.patientId,
      'INVOICE',
      `Invoice ${invoice.number} — ₹${total.toFixed(0)}`,
      items.map((i) => i.description).join(', '),
      'Invoice',
      invoice.id,
    );
    return invoice;
  }

  async voidInvoice(id: number) {
    // Voiding an invoice that has payments would turn those payments into
    // phantom credit and deflate the patient's outstanding balance.
    const paid = await this.prisma.payment.count({ where: { invoiceId: id } });
    if (paid > 0) {
      throw new BadRequestException(
        'This invoice has payments recorded against it — it cannot be voided',
      );
    }
    const invoice = await this.prisma.invoice.update({ where: { id }, data: { status: 'VOID' } });
    await this.timeline.add(invoice.patientId, 'INVOICE', `Invoice ${invoice.number} voided`, undefined, 'Invoice', id);
    return invoice;
  }

  async recordPayment(input: PaymentInput) {
    if (!input?.patientId || !input?.amount || input.amount <= 0) {
      throw new BadRequestException('patientId and a positive amount are required');
    }
    // A payment against a voided or foreign invoice silently corrupts the derived
    // outstanding math — validate the target before accepting money against it.
    if (input.invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { id: input.invoiceId } });
      if (!invoice) throw new BadRequestException('Invoice not found');
      if (invoice.status === 'VOID') throw new BadRequestException('Cannot record a payment against a voided invoice');
      if (invoice.patientId !== input.patientId) {
        throw new BadRequestException('Invoice belongs to a different patient');
      }
    }
    const method = input.method && METHODS.includes(input.method) ? input.method : 'CASH';
    const payment = await this.prisma.payment.create({
      data: {
        patientId: input.patientId,
        invoiceId: input.invoiceId,
        amount: Number(input.amount),
        method,
        reference: input.reference,
        notes: input.notes,
      },
    });
    if (input.invoiceId) await this.refreshInvoiceStatus(input.invoiceId);
    await this.timeline.add(
      input.patientId,
      'PAYMENT',
      `₹${Number(input.amount).toFixed(0)} paid (${method.toLowerCase()})`,
      input.notes,
      'Payment',
      payment.id,
    );
    return payment;
  }

  private async refreshInvoiceStatus(invoiceId: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { payments: true },
    });
    if (!invoice || invoice.status === 'VOID') return;
    const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
    const status = paid >= invoice.total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN';
    await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status } });
  }

  listPayments(patientId?: number) {
    return this.prisma.payment.findMany({
      where: patientId ? { patientId } : {},
      include: {
        invoice: { select: { id: true, number: true } },
        patient: { select: { id: true, name: true, code: true } },
      },
      orderBy: { paidAt: 'desc' },
    });
  }

  /** All patients with dues, for the billing page and reports. */
  async outstanding() {
    const invoices = await this.prisma.invoice.groupBy({
      by: ['patientId'],
      where: { status: { not: 'VOID' } },
      _sum: { total: true },
    });
    const payments = await this.prisma.payment.groupBy({
      by: ['patientId'],
      _sum: { amount: true },
    });
    const paidMap = new Map(payments.map((p) => [p.patientId, p._sum.amount ?? 0]));
    const rows = invoices
      .map((inv) => ({
        patientId: inv.patientId,
        billed: inv._sum.total ?? 0,
        paid: paidMap.get(inv.patientId) ?? 0,
        outstanding: (inv._sum.total ?? 0) - (paidMap.get(inv.patientId) ?? 0),
      }))
      .filter((r) => r.outstanding > 0.005)
      .sort((a, b) => b.outstanding - a.outstanding);
    const patients = await this.prisma.patient.findMany({
      where: { id: { in: rows.map((r) => r.patientId) } },
      select: { id: true, name: true, code: true, phone: true },
    });
    const patientMap = new Map(patients.map((p) => [p.id, p]));
    return rows.map((r) => ({ ...r, patient: patientMap.get(r.patientId) }));
  }
}
