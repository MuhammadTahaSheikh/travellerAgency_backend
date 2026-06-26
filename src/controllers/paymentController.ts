import { Response } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../types';
import { paginate, formatPagination, generateNumber, applyDateFilter, serializeForDeletedRecord } from '../utils/helpers';
import { paramId } from '../utils/params';
import { logActivity } from '../middleware/activityLogger';
import { createJournalEntry, resolvePaymentCreditAccount, reverseJournalEntry } from '../services/ledgerService';
import { convertCurrency, getDefaultExchangeRate } from '../services/currencyService';
import { createSchedulesFromInvoice } from '../services/scheduleService';

const TX_OPTS = { maxWait: 15000, timeout: 30000 };

export async function getPayments(req: AuthRequest, res: Response) {
  const { page, limit, skip } = paginate(req.query.page as string, req.query.limit as string);
  const startDate = req.query.startDate as string;
  const endDate = req.query.endDate as string;

  const where = applyDateFilter({}, 'paymentDate', startDate, endDate);

  const [payments, total, aggregate] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { paymentDate: 'desc' },
      include: {
        invoice: { include: { customer: true } },
        account: true,
        recordedBy: { select: { firstName: true, lastName: true } },
        vouchers: true,
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);

  return res.json({
    success: true,
    data: payments,
    pagination: formatPagination(total, page, limit),
    summary: { totalAmount: Number(aggregate._sum.amount || 0), count: total },
  });
}

export async function createPayment(req: AuthRequest, res: Response) {
  const {
    invoiceId,
    accountId,
    amount,
    currency,
    exchangeRate,
    method,
    reference,
    notes,
    paymentDate,
    autoVerify,
    attachmentPath,
  } = req.body;

  if (!amount || !accountId) {
    return res.status(400).json({ success: false, error: 'Amount and account are required' });
  }

  const paymentAmount = Number(amount);
  if (paymentAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be greater than zero' });
  }

  const payCurrency: 'PKR' | 'SAR' = currency === 'SAR' ? 'SAR' : 'PKR';
  const rate = exchangeRate ? Number(exchangeRate) : await getDefaultExchangeRate();
  const { amountPkr, amountSar } = convertCurrency(paymentAmount, payCurrency, rate);

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const receivingAccount = await tx.account.findUnique({ where: { id: accountId } });
      if (!receivingAccount) throw new Error('Selected account not found');
      if (!['CASH', 'BANK'].includes(receivingAccount.type)) {
        throw new Error('Payments must be recorded to a Cash or Bank account');
      }

      const verified = autoVerify !== false;

      const pmt = await tx.payment.create({
        data: {
          paymentNumber: generateNumber('PAY'),
          invoiceId: invoiceId || null,
          accountId,
          amount: paymentAmount,
          currency: payCurrency,
          exchangeRate: rate,
          amountPkr,
          amountSar,
          method: method || 'CASH',
          reference,
          notes,
          attachmentPath,
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          recordedById: req.user!.id,
          verificationStatus: verified ? 'VERIFIED' : 'PENDING',
          verifiedAt: verified ? new Date() : undefined,
        },
        include: { invoice: true, account: true },
      });

      let journalEntryId: string | undefined;

      if (verified) {
        if (invoiceId) {
          const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
          if (invoice) {
            const newPaid = Number(invoice.paidAmount) + paymentAmount;
            const status = newPaid >= Number(invoice.totalAmount) ? 'PAID' : 'PARTIAL';
            await tx.invoice.update({
              where: { id: invoiceId },
              data: { paidAmount: newPaid, status, approvalStatus: 'PENDING' },
            });
            if (invoice.bookingId) {
              await tx.booking.update({
                where: { id: invoice.bookingId },
                data: { paidAmount: { increment: paymentAmount } },
              });
            }
          }
        }

        const creditAccount = await resolvePaymentCreditAccount(invoiceId, tx);
        const entry = await createJournalEntry(
          `Payment received: ${pmt.paymentNumber}`,
          [
            {
              accountId,
              debit: paymentAmount,
              description: 'Payment received',
              currency: payCurrency,
              exchangeRate: rate,
              amountPkr,
              amountSar,
              paymentMethod: method || 'CASH',
              attachmentPath,
            },
            {
              accountId: creditAccount.id,
              credit: paymentAmount,
              description: 'Reduce receivable',
              currency: payCurrency,
              exchangeRate: rate,
              amountPkr,
              amountSar,
            },
          ],
          { reference: pmt.paymentNumber, receiptPath: attachmentPath },
          tx
        );
        journalEntryId = entry.id;

        await tx.payment.update({
          where: { id: pmt.id },
          data: { journalEntryId },
        });
      }

      return { ...pmt, journalEntryId, invoiceId: invoiceId || null, verified };
    }, TX_OPTS);

    if (payment.verified && payment.invoiceId) {
      await createSchedulesFromInvoice(payment.invoiceId);
    }

    await logActivity(req, 'CREATE', 'Payment', payment.id);

    return res.status(201).json({
      success: true,
      data: payment,
      message: payment.invoiceId
        ? 'Payment recorded. Awaiting super admin approval for voucher issuance.'
        : 'Payment recorded',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to record payment';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function verifyPayment(req: AuthRequest, res: Response) {
  const payment = await prisma.payment.findUnique({
    where: { id: paramId(req) },
    include: { invoice: true },
  });

  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  if (payment.verificationStatus === 'VERIFIED') {
    return res.status(400).json({ success: false, error: 'Payment already verified' });
  }

  try {
    const paymentAmount = Number(payment.amount);
    const payCurrency = payment.currency || 'PKR';
    const rate = Number(payment.exchangeRate || (await getDefaultExchangeRate()));
    const { amountPkr, amountSar } = convertCurrency(paymentAmount, payCurrency, rate);

    const updated = await prisma.$transaction(async (tx) => {
      if (payment.invoiceId && payment.invoice) {
        const newPaid = Number(payment.invoice.paidAmount) + paymentAmount;
        const status = newPaid >= Number(payment.invoice.totalAmount) ? 'PAID' : 'PARTIAL';
        await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: { paidAmount: newPaid, status, approvalStatus: 'PENDING' },
        });
        if (payment.invoice.bookingId) {
          await tx.booking.update({
            where: { id: payment.invoice.bookingId },
            data: { paidAmount: { increment: paymentAmount } },
          });
        }
      }

      const creditAccount = await resolvePaymentCreditAccount(payment.invoiceId || undefined, tx);
      const entry = await createJournalEntry(
        `Payment verified: ${payment.paymentNumber}`,
        [
          {
            accountId: payment.accountId,
            debit: paymentAmount,
            description: 'Payment received',
            currency: payCurrency,
            exchangeRate: rate,
            amountPkr,
            amountSar,
            paymentMethod: payment.method,
          },
          {
            accountId: creditAccount.id,
            credit: paymentAmount,
            description: 'Reduce receivable',
            currency: payCurrency,
            exchangeRate: rate,
            amountPkr,
            amountSar,
          },
        ],
        { reference: payment.paymentNumber },
        tx
      );

      return tx.payment.update({
        where: { id: payment.id },
        data: {
          verificationStatus: 'VERIFIED',
          verifiedAt: new Date(),
          journalEntryId: entry.id,
        },
        include: { invoice: true, account: true },
      });
    }, TX_OPTS);

    await logActivity(req, 'UPDATE', 'Payment', payment.id, 'Verified');

    if (payment.invoiceId) {
      await createSchedulesFromInvoice(payment.invoiceId);
    }

    return res.json({
      success: true,
      data: updated,
      message: 'Payment verified. Awaiting super admin approval for voucher issuance.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to verify payment';
    return res.status(400).json({ success: false, error: message });
  }
}

export async function deletePayment(req: AuthRequest, res: Response) {
  const payment = await prisma.payment.findUnique({
    where: { id: paramId(req) },
    include: { invoice: true },
  });

  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  await prisma.$transaction(async (tx) => {
    if (payment.journalEntryId) {
      await reverseJournalEntry(payment.journalEntryId, `Reversal: ${payment.paymentNumber}`, tx);
    }

    if (payment.invoiceId && payment.invoice && payment.verificationStatus === 'VERIFIED') {
      const newPaid = Math.max(0, Number(payment.invoice.paidAmount) - Number(payment.amount));
      let status: 'SENT' | 'PARTIAL' | 'PAID' = 'SENT';
      if (newPaid > 0 && newPaid < Number(payment.invoice.totalAmount)) status = 'PARTIAL';
      if (newPaid >= Number(payment.invoice.totalAmount)) status = 'PAID';

      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { paidAmount: newPaid, status },
      });

      if (payment.invoice.bookingId) {
        await tx.booking.update({
          where: { id: payment.invoice.bookingId },
          data: { paidAmount: { decrement: Number(payment.amount) } },
        });
      }
    }

    await tx.deletedRecord.create({
      data: {
        entity: 'Payment',
        entityId: payment.id,
        data: serializeForDeletedRecord(payment),
        deletedBy: req.user?.id,
      },
    });

    await tx.payment.delete({ where: { id: paramId(req) } });
  }, TX_OPTS);

  await logActivity(req, 'DELETE', 'Payment', paramId(req));
  return res.json({ success: true, message: 'Payment deleted' });
}

export async function getDailyCollection(req: AuthRequest, res: Response) {
  const date = req.query.date ? new Date(req.query.date as string) : new Date();
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: startOfDay, lte: endOfDay }, verificationStatus: 'VERIFIED' },
    include: { invoice: { include: { customer: true } }, account: true },
  });

  const total = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  return res.json({ success: true, data: { payments, total, date: startOfDay } });
}

export async function getAccounts(_req: AuthRequest, res: Response) {
  const accounts = await prisma.account.findMany({
    where: { isActive: true, type: { in: ['CASH', 'BANK'] } },
    orderBy: { name: 'asc' },
  });
  return res.json({ success: true, data: accounts });
}

export async function createAccount(req: AuthRequest, res: Response) {
  const { name, code, type, description } = req.body;
  const account = await prisma.account.create({
    data: { name, code: code || generateNumber('ACC'), type, description },
  });
  await logActivity(req, 'CREATE', 'Account', account.id);
  return res.status(201).json({ success: true, data: account });
}
