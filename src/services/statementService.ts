import prisma from '../config/database';
import { getLedgerTransactions, buildLedgerRows } from './ledgerService';
import { documentHeaderHtml, issuerFromCustomer, DOCUMENT_STYLES, BRAND_NAME } from './documentBrand';

export async function getCustomerStatementData(customerId: string, currency: 'PKR' | 'SAR' = 'PKR') {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      account: true,
      invoices: { orderBy: { issueDate: 'desc' }, include: { items: true, payments: true } },
    },
  });

  if (!customer) throw new Error('Customer not found');

  let transactions: ReturnType<typeof buildLedgerRows> = [];
  if (customer.account) {
    const raw = await getLedgerTransactions({ accountId: customer.account.id });
    transactions = buildLedgerRows(raw, currency).reverse();
  }

  const totalBilled = customer.invoices
    .filter((i) => i.status !== 'CANCELLED')
    .reduce((s, i) => s + Number(i.totalAmount), 0);
  const totalPaid = customer.invoices
    .filter((i) => i.status !== 'CANCELLED')
    .reduce((s, i) => s + Number(i.paidAmount), 0);

  return {
    customer: {
      id: customer.id,
      customerType: customer.customerType,
      firstName: customer.firstName,
      lastName: customer.lastName,
      companyName: customer.companyName,
      tradePartnerId: customer.tradePartnerId,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      contactPerson: customer.contactPerson,
    },
    currency,
    summary: {
      totalBilled,
      totalPaid,
      outstanding: totalBilled - totalPaid,
      balancePkr: Number(customer.account?.balancePkr || 0),
      balanceSar: Number(customer.account?.balanceSar || 0),
    },
    invoices: customer.invoices,
    transactions,
    generatedAt: new Date(),
  };
}

export async function renderCustomerStatementHtml(
  customerId: string,
  currency: 'PKR' | 'SAR' = 'PKR',
  baseUrl?: string
) {
  const data = await getCustomerStatementData(customerId, currency);
  const issuer = issuerFromCustomer(data.customer);
  const balance = currency === 'SAR' ? data.summary.balanceSar : data.summary.balancePkr;
  const clientName = issuer.isB2B
    ? issuer.name
    : `${data.customer.firstName} ${data.customer.lastName}`;

  const txRows = data.transactions
    .map((t) => {
      const amount = t.debit > 0 ? t.debit : t.credit;
      const type = t.debit > 0 ? 'Debit' : 'Credit';
      const date = t.journalEntry?.date ? new Date(t.journalEntry.date).toLocaleDateString() : '—';
      return `<tr>
        <td>${date}</td>
        <td>${t.description || t.remarks || '—'}</td>
        <td>${type}</td>
        <td style="text-align:right">${Number(amount).toLocaleString()}</td>
        <td style="text-align:right">${Number(t.runningBalance).toLocaleString()}</td>
      </tr>`;
    })
    .join('');

  const invoiceRows = data.invoices
    .filter((i) => i.status !== 'CANCELLED')
    .map(
      (i) => `<tr>
        <td>${i.invoiceNumber}</td>
        <td>${new Date(i.issueDate).toLocaleDateString()}</td>
        <td>${i.status}</td>
        <td style="text-align:right">${Number(i.totalAmount).toLocaleString()}</td>
        <td style="text-align:right">${Number(i.paidAmount).toLocaleString()}</td>
        <td style="text-align:right">${(Number(i.totalAmount) - Number(i.paidAmount)).toLocaleString()}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Customer Statement — ${clientName}</title>
<style>${DOCUMENT_STYLES}</style></head><body>
${documentHeaderHtml(issuer, baseUrl, 'CUSTOMER STATEMENT')}
<p style="margin:0 0 4px"><strong>Account:</strong> ${clientName}</p>
<p style="margin:0;color:#64748b;font-size:13px">Currency: ${currency} · Generated: ${data.generatedAt.toLocaleString()}</p>

<div class="summary-grid">
  <div class="summary-box"><div class="summary-label">Total Billed</div><div class="summary-value">${data.summary.totalBilled.toLocaleString()}</div></div>
  <div class="summary-box"><div class="summary-label">Total Paid</div><div class="summary-value">${data.summary.totalPaid.toLocaleString()}</div></div>
  <div class="summary-box"><div class="summary-label">Outstanding</div><div class="summary-value">${data.summary.outstanding.toLocaleString()}</div></div>
  <div class="summary-box"><div class="summary-label">Ledger Balance (${currency})</div><div class="summary-value">${balance.toLocaleString()}</div></div>
</div>

<h3 style="margin-top:24px">Invoices</h3>
<table>
  <thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th align="right">Total</th><th align="right">Paid</th><th align="right">Due</th></tr></thead>
  <tbody>${invoiceRows || '<tr><td colspan="6">No invoices</td></tr>'}</tbody>
</table>

<h3 style="margin-top:24px">Ledger Transactions (${currency})</h3>
<table>
  <thead><tr><th>Date</th><th>Description</th><th>Type</th><th align="right">Amount</th><th align="right">Balance</th></tr></thead>
  <tbody>${txRows || '<tr><td colspan="5">No transactions</td></tr>'}</tbody>
</table>

<div class="footer">
  ${issuer.isB2B ? `${issuer.name} — Statement prepared by ${BRAND_NAME}` : BRAND_NAME}
</div>
</body></html>`;
}
