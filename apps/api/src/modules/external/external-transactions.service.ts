import { BadRequestException, Injectable } from '@nestjs/common';
import type { ServerInferRequest } from '@ts-rest/core';
import type { Account, Transaction } from '@ft/api-database';
import type { externalContract } from '@ft/shared-contracts';
import type { RequestApiKey } from '../_core/authn/request-user';
import { TransactionsService, type UpdateTransactionInput } from '../ledger/transactions/transactions.service';
import { ExternalLookupService } from './external-lookup.service';
import { favouriteAccount, findAccount, namesCategory, resolveCategoryPair, transferDestAmount } from './references';

type CreateBody = ServerInferRequest<typeof externalContract.transactions.create>['body'];
type UpdateBody = ServerInferRequest<typeof externalContract.transactions.update>['body'];

/**
 * Turns an external request into what TransactionsService takes: names become ids, the currency
 * comes from the account, the date defaults to now. Everything else — permissions, validation,
 * balances, realtime updates — is TransactionsService's, exactly as for the web app.
 */
@Injectable()
export class ExternalTransactionsService {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  async create({ userId, groupId }: RequestApiKey, body: CreateBody): Promise<Transaction> {
    const accounts = await this.lookup.accountsOf(groupId);
    const account = findAccount(accounts, body.accountId, body.accountName, 'account') ?? favouriteAccount(accounts);

    let toAccountId: string | null = null;
    let destAmount: string | null = null;
    if (body.type === 'transfer') {
      const toAccount = findAccount(accounts, body.toAccountId, body.toAccountName, 'toAccount');
      if (!toAccount) {
        throw new BadRequestException('A transfer needs toAccountId or toAccountName');
      }
      assertTwoAccounts(account, toAccount);
      toAccountId = toAccount.id;
      destAmount = transferDestAmount(account, toAccount, body.destAmount);
    } else {
      assertNoTransferFields(body);
    }

    const pair = namesCategory(body) ? resolveCategoryPair(await this.lookup.categoriesOf(groupId), body.type, body) : {};
    const note = body.note?.trim();

    const { transaction } = await this.transactions.create(userId, groupId, {
      type: body.type,
      // The moment the request arrives, which for a notification is when the money moved.
      date: body.date ?? new Date().toISOString(),
      amount: body.amount,
      // A transaction is recorded in its account's currency, as the app itself does.
      currencyId: account.currencyId,
      accountId: account.id,
      categoryId: pair.categoryId ?? null,
      subcategoryId: pair.subcategoryId ?? null,
      toAccountId,
      destAmount,
      note: note || undefined,
    });
    return transaction;
  }

  async update({ userId, groupId }: RequestApiKey, transactionId: string, body: UpdateBody): Promise<Transaction> {
    // Also the 404 for a transaction that isn't there, before any name is looked up.
    const { transaction: existing } = await this.transactions.get(userId, groupId, transactionId);
    const accounts = await this.lookup.accountsOf(groupId);
    const stored = (id: string) => accounts.find((candidate) => candidate.id === id) as Account;

    const patch: UpdateTransactionInput = {};
    const account = findAccount(accounts, body.accountId, body.accountName, 'account');
    const from = account ?? stored(existing.accountId);
    if (account) {
      patch.accountId = account.id;
      patch.currencyId = account.currencyId;
    }

    if (existing.type === 'transfer') {
      const toAccount = findAccount(accounts, body.toAccountId, body.toAccountName, 'toAccount');
      const to = toAccount ?? stored(existing.toAccountId as string);
      assertTwoAccounts(from, to);
      if (toAccount) {
        patch.toAccountId = toAccount.id;
      }
      // The stored amount was entered for the stored pair of currencies, and only holds for it.
      const sameCurrencies =
        from.currencyId === stored(existing.accountId).currencyId &&
        to.currencyId === stored(existing.toAccountId as string).currencyId;
      patch.destAmount = transferDestAmount(from, to, body.destAmount, sameCurrencies ? existing.destAmount : null);
    } else {
      assertNoTransferFields(body);
    }

    if (namesCategory(body)) {
      const pair = resolveCategoryPair(await this.lookup.categoriesOf(groupId), existing.type, body, existing.categoryId);
      if (pair.categoryId !== undefined) {
        patch.categoryId = pair.categoryId;
      }
      if (pair.subcategoryId !== undefined) {
        patch.subcategoryId = pair.subcategoryId;
      }
    }
    if (body.amount !== undefined) {
      patch.amount = body.amount;
    }
    if (body.date !== undefined) {
      patch.date = body.date;
    }
    if (body.note !== undefined) {
      // An empty note clears it, as in the app's own API.
      patch.note = body.note.trim();
    }

    const { transaction } = await this.transactions.update(userId, groupId, transactionId, patch);
    return transaction;
  }
}

function assertTwoAccounts(from: { id: string }, to: { id: string }): void {
  if (from.id === to.id) {
    throw new BadRequestException('A transfer needs two different accounts');
  }
}

function assertNoTransferFields(body: { toAccountId?: string; toAccountName?: string; destAmount?: string }): void {
  if (body.toAccountId !== undefined || body.toAccountName !== undefined) {
    throw new BadRequestException('Only a transfer has a destination account');
  }
  if (body.destAmount !== undefined) {
    throw new BadRequestException('destAmount only applies to transfers');
  }
}
