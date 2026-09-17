import { Table } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// The last rates fetched for each base currency, one row per base and overwritten on refresh —
// a cache rather than a record, so nothing accumulates here. Reference data like `currencies`:
// readable by anyone signed in, written only by the API, so no row-level security of its own.
export const addExchangeRatesCache: Migration = {
  name: '20260919160000-add-exchange-rates-cache',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.createTable(
      new Table({
        name: 'exchange_rates',
        columns: [
          { name: 'base_code', type: 'text', isPrimary: true },
          { name: 'rates', type: 'jsonb', isNullable: false },
          // What the provider published, which trails `fetched_at` by design.
          { name: 'published_on', type: 'date', isNullable: false },
          { name: 'provider', type: 'text', isNullable: false },
          { name: 'fetched_at', type: 'timestamptz', isNullable: false },
        ],
      }),
      true,
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropTable('exchange_rates', true);
  },
};
