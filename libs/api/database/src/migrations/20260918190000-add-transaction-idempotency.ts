import { TableCheck, TableColumn, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// A transaction recorded through the external API for a request with an idempotency key carries
// that key's sha256, so a repeat of the request — a bank posting the same notification twice —
// finds it instead of recording the money twice. Beside it, a digest of what the request asked
// for, which tells a repeat from a different transaction that reuses the key.
//
// The unique index counts soft-deleted rows on purpose, like the recurring occurrences' one: a
// transaction someone deleted keeps its key, so the same request can't bring it back.
export const addTransactionIdempotency: Migration = {
  name: '20260918190000-add-transaction-idempotency',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumns('transactions', [
      new TableColumn({ name: 'idempotency_key', type: 'text', isNullable: true }),
      new TableColumn({ name: 'idempotency_fingerprint', type: 'text', isNullable: true }),
    ]);
    await queryRunner.createCheckConstraint(
      'transactions',
      new TableCheck({
        name: 'chk_transaction_idempotency',
        expression: '(idempotency_key IS NULL) = (idempotency_fingerprint IS NULL)',
      }),
    );
    await queryRunner.createIndex(
      'transactions',
      new TableIndex({
        name: 'uq_transactions_idempotency_key',
        columnNames: ['group_id', 'idempotency_key'],
        isUnique: true,
        where: 'idempotency_key IS NOT NULL',
      }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropIndex('transactions', 'uq_transactions_idempotency_key');
    await queryRunner.dropCheckConstraint('transactions', 'chk_transaction_idempotency');
    await queryRunner.dropColumn('transactions', 'idempotency_fingerprint');
    await queryRunner.dropColumn('transactions', 'idempotency_key');
  },
};
