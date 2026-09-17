import { TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Rates the user keeps by hand, against their main currency: { "USD": "41.5" }. Only the totals
// that mix currencies use them, and nothing here fetches rates from anywhere — that comes later,
// at which point these stay as the manual override.
export const addProfileExchangeRates: Migration = {
  name: '20260918140000-add-profile-exchange-rates',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn(
      'profiles',
      new TableColumn({ name: 'exchange_rates', type: 'jsonb', isNullable: true }),
    );
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropColumn('profiles', 'exchange_rates');
  },
};
