import prisma from '../config/database';
import { Account } from '@prisma/client';
import { createJournalEntry, createCustomerAccount } from './ledgerService';
import { createVendorAccount } from './vendorService';
import { convertCurrency, getDefaultExchangeRate } from './currencyService';
import { allocateInternalTransferReference } from './numberingService';

export type InternalEntityType = 'B2B' | 'VENDOR';

export type LedgerTransferInput = {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  currency?: 'PKR' | 'SAR';
  exchangeRate?: number;
  description?: string;
  date?: Date;
  reference?: string;
  notes?: string;
};

export type InternalTransferInput = {
  sourceType: InternalEntityType;
  sourceEntityId: string;
  targetType: InternalEntityType;
  targetEntityId: string;
  amount: number;
  currency?: 'PKR' | 'SAR';
  exchangeRate?: number;
  remarks?: string;
  date?: Date;
};

async function resolveEntityAccount(type: InternalEntityType, entityId: string): Promise<{ account: Account; name: string }> {
  if (type === 'VENDOR') {
    const vendor = await prisma.vendor.findUnique({
      where: { id: entityId },
      include: { account: true },
    });
    if (!vendor || !vendor.isActive) throw new Error('Vendor not found');
    let account = vendor.account;
    if (!account) account = await createVendorAccount(vendor.id, vendor.name);
    return { account, name: vendor.name };
  }

  const customer = await prisma.customer.findUnique({
    where: { id: entityId },
    include: { account: true },
  });
  if (!customer || !customer.isActive) throw new Error('B2B client not found');
  if (customer.customerType !== 'B2B') throw new Error('Only B2B clients can be used for internal transfers');
  const displayName = customer.companyName || `${customer.firstName} ${customer.lastName}`.trim();
  let account = customer.account;
  if (!account) account = await createCustomerAccount(customer.id, displayName);
  return { account, name: displayName };
}

function assertInternalAccount(account: Account) {
  if (!account.customerId && !account.vendorId) {
    throw new Error('Internal transfers are only allowed between B2B client and vendor ledgers');
  }
  if (['CASH', 'BANK'].includes(account.type)) {
    throw new Error('Cash and bank accounts cannot be used for internal transfers');
  }
  if (!account.isActive) throw new Error('Ledger account must be active');
}

/** Shared dual-entry transfer — no cash/bank movement. */
export async function executeLedgerTransfer(input: LedgerTransferInput) {
  const { fromAccountId, toAccountId, amount, currency, exchangeRate, description, date, reference, notes } = input;

  if (!fromAccountId || !toAccountId || !amount) {
    throw new Error('Source account, destination account, and amount are required');
  }
  if (fromAccountId === toAccountId) {
    throw new Error('Source and destination ledgers must be different');
  }

  const transferAmount = Number(amount);
  if (transferAmount <= 0) throw new Error('Amount must be greater than zero');

  const transferCurrency: 'PKR' | 'SAR' = currency === 'SAR' ? 'SAR' : 'PKR';
  const rate = exchangeRate ? Number(exchangeRate) : await getDefaultExchangeRate();
  const { amountPkr, amountSar } = convertCurrency(transferAmount, transferCurrency, rate);

  const [fromAccount, toAccount] = await Promise.all([
    prisma.account.findUnique({ where: { id: fromAccountId } }),
    prisma.account.findUnique({ where: { id: toAccountId } }),
  ]);
  if (!fromAccount || !toAccount) throw new Error('One or both ledger accounts not found');
  if (!fromAccount.isActive || !toAccount.isActive) throw new Error('Both ledger accounts must be active');

  const desc = description || `Transfer: ${fromAccount.name} → ${toAccount.name}`;
  const journalLine = { currency: transferCurrency, exchangeRate: rate, amountPkr, amountSar };

  return createJournalEntry(
    desc,
    [
      {
        accountId: toAccountId,
        debit: transferAmount,
        description: `Internal transfer received from ${fromAccount.name}`,
        ...journalLine,
      },
      {
        accountId: fromAccountId,
        credit: transferAmount,
        description: `Internal transfer sent to ${toAccount.name}`,
        ...journalLine,
      },
    ],
    { date: date || undefined, reference, notes }
  );
}

export async function createInternalTransfer(input: InternalTransferInput) {
  const {
    sourceType,
    sourceEntityId,
    targetType,
    targetEntityId,
    amount,
    currency,
    exchangeRate,
    remarks,
    date,
  } = input;

  if (!sourceEntityId || !targetEntityId) {
    throw new Error('Source and target entities are required');
  }
  if (sourceType === targetType && sourceEntityId === targetEntityId) {
    throw new Error('Source and destination must be different entities');
  }

  const [source, target] = await Promise.all([
    resolveEntityAccount(sourceType, sourceEntityId),
    resolveEntityAccount(targetType, targetEntityId),
  ]);

  assertInternalAccount(source.account);
  assertInternalAccount(target.account);

  if (source.account.id === target.account.id) {
    throw new Error('Source and destination ledgers must be different');
  }

  const transferRef = await allocateInternalTransferReference();
  const narration = remarks?.trim() || `Internal transfer: ${source.name} → ${target.name}`;

  const entry = await executeLedgerTransfer({
    fromAccountId: source.account.id,
    toAccountId: target.account.id,
    amount,
    currency,
    exchangeRate,
    description: narration,
    reference: transferRef,
    notes: remarks,
    date: date ? new Date(date) : undefined,
  });

  return {
    entry,
    transferReference: transferRef,
    source: { type: sourceType, name: source.name, accountId: source.account.id },
    target: { type: targetType, name: target.name, accountId: target.account.id },
  };
}
