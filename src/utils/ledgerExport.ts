import { Response } from 'express';
import { buildLedgerRows, CurrencyView, getLedgerTransactions } from '../services/ledgerService';
import { rowsToCsv, wrapHtmlDocument, escapeHtml } from './exportHelpers';

function ledgerRowsForExport(rows: ReturnType<typeof buildLedgerRows>) {
  return rows.map((r) => ({
    date: r.journalEntry?.date ? new Date(r.journalEntry.date).toISOString().split('T')[0] : '',
    entry: r.journalEntry?.entryNumber || '',
    account: r.account?.name || '',
    description: r.description || r.journalEntry?.description || '',
    debit: Number(r.debit) > 0 ? Number(r.debit) : '',
    credit: Number(r.credit) > 0 ? Number(r.credit) : '',
    balance: r.runningBalance ?? '',
    currency: r.displayCurrency,
  }));
}

export async function sendLedgerExport(
  res: Response,
  opts: {
    accountId: string;
    title: string;
    subtitle: string;
    filename: string;
    format: string;
    currencyView: CurrencyView;
    startDate?: Date;
    endDate?: Date;
  }
) {
  const transactions = await getLedgerTransactions({
    accountId: opts.accountId,
    startDate: opts.startDate,
    endDate: opts.endDate,
  });
  const rows = ledgerRowsForExport(buildLedgerRows(transactions, opts.currencyView).reverse());

  if (opts.format === 'html') {
    const body = `
      <h1>${opts.title}</h1>
      <p class="meta">${opts.subtitle} · ${opts.currencyView} view · ${rows.length} transaction(s)</p>
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${escapeHtml(r.date)}</td><td>${escapeHtml(r.entry)}</td><td>${escapeHtml(r.description)}</td><td class="num">${escapeHtml(r.debit)}</td><td class="num">${escapeHtml(r.credit)}</td><td class="num">${escapeHtml(r.balance)}</td></tr>`).join('')}</tbody>
      </table>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(wrapHtmlDocument(opts.title, body));
  }

  const csv = rowsToCsv(
    ['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance', 'Currency'],
    rows.map((r) => [r.date, r.entry, r.description, r.debit, r.credit, r.balance, r.currency])
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${opts.filename}"`);
  return res.send(csv);
}
