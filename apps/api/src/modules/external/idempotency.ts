import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { normalizeName } from './references';

// Idempotency keys for recording transactions: a request that repeats one the group has had —
// a bank posting the same notification twice, a client retrying after a timeout — gets the
// transaction the first one recorded instead of a second one.

/** The key a request carries in the Idempotency-Key header or the body — one key, so both must agree. */
export function idempotencyKeyOf(header: string | undefined, bodyField: string | undefined): string | undefined {
  if (header !== undefined && bodyField !== undefined && header !== bodyField) {
    throw new BadRequestException('The Idempotency-Key header and idempotencyKey differ; send one of them');
  }
  return header ?? bodyField;
}

// Only a digest is stored: a key may well be a notification's text, which has no business in the
// database, and a digest is a fixed size whatever the key's length.
export function hashIdempotencyKey(key: string): string {
  return sha256(key);
}

export interface MoneyMovement {
  type: string;
  amount: string;
  accountId?: string;
  accountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  destAmount?: string;
}

/**
 * What makes two requests the same transaction: the money, and the accounts it moves between.
 * The date, the note and the category stay out — a repeat may word them differently, with a date
 * taken from when it was sent or a note with the time in it — while a different amount or account
 * under one key means the key isn't telling transactions apart, which is worth refusing rather
 * than dropping the second one quietly. Amounts and names count as the lookup reads them, so
 * "12.5" repeats "12.50" and "card" repeats "Card".
 */
export function movementFingerprint(request: MoneyMovement): string {
  return sha256(
    JSON.stringify([
      request.type,
      canonicalMoney(request.amount),
      request.accountId ?? null,
      request.accountName === undefined ? null : normalizeName(request.accountName),
      request.toAccountId ?? null,
      request.toAccountName === undefined ? null : normalizeName(request.toAccountName),
      request.destAmount === undefined ? null : canonicalMoney(request.destAmount),
    ]),
  );
}

// Two decimals always: parseMoneyInput keeps what was typed, "12.5" as much as "12.50".
function canonicalMoney(amount: string): string {
  const [whole, fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
