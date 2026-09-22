import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { ServerInferRequest } from '@ts-rest/core';
import type { Transaction } from '@ft/api-database';
import { NOTIFICATION_BANK_NAMES, type externalContract } from '@ft/shared-contracts';
import type { RequestApiKey } from '../../_core/authn/request-user';
import { ExternalLookupService } from '../external-lookup.service';
import { ExternalTransactionsService } from '../external-transactions.service';
import { NOTIFICATION_PARSERS } from './notification-parsers';
import { receivingAccount } from './receiving-account';

type ForwardBody = ServerInferRequest<typeof externalContract.notifications.forward>['body'];

export type ForwardedNotification =
  | { recorded: true; transaction: Transaction; replayed: boolean }
  | { recorded: false; reason: string };

/**
 * Records what a forwarded bank notification says. The phone knows only which bank's app posted
 * it; the rest comes from here — the bank's parser reads the text, and the group's settings say
 * which account receives that bank's notifications. The recording itself is the external API's
 * POST /transactions, idempotency included, so permissions, validation and balances are the same.
 */
@Injectable()
export class ExternalNotificationsService {
  constructor(
    private readonly transactions: ExternalTransactionsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  async forward(apiKey: RequestApiKey, { type: bank, text }: ForwardBody): Promise<ForwardedNotification> {
    const parsed = NOTIFICATION_PARSERS[bank](text);
    if (!parsed) {
      throw new UnprocessableEntityException(
        `This isn't worded like any ${NOTIFICATION_BANK_NAMES[bank]} notification the API knows how to read`,
      );
    }
    if (parsed.kind === 'skip') {
      return { recorded: false, reason: parsed.reason };
    }

    const accounts = await this.lookup.accountsOf(apiKey.groupId);
    const currencies = await this.lookup.currencyCodes();
    const account = receivingAccount(accounts, bank, parsed.currency, (currencyId) => currencies.of(currencyId));

    const { transaction, replayed } = await this.transactions.create(
      apiKey,
      {
        type: parsed.type,
        amount: parsed.amount,
        accountId: account.id,
        note: parsed.counterparty ?? undefined,
      },
      notificationKey(bank, text),
    );
    return { recorded: true, transaction, replayed };
  }
}

/**
 * The idempotency key of a forwarded notification: its text, which a bank posting the same
 * notification twice repeats exactly, and which differs between two payments — the balance after
 * each is in it. Line endings are evened out, in case one copy arrives with \r\n; the prefix keeps
 * it from ever meeting a key a client chose itself for POST /transactions.
 */
export function notificationKey(bank: string, text: string): string {
  return `notification:${bank}:${text.normalize('NFC').replace(/\r\n?/g, '\n').trim()}`;
}
