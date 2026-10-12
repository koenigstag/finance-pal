import { TableCheck, TableColumn, TableForeignKey } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

const DEST_AS_OF_CHECK = 'chk_transaction_dest_amount_as_of';
const DEST_AS_OF_BEFORE = 'dest_amount_as_of IS NULL OR to_account_id IS NOT NULL';
const DEST_AS_OF_AFTER = 'dest_amount_as_of IS NULL OR to_account_id IS NOT NULL OR category_id IS NOT NULL';

// A category's own currency, as 1Money has one for every category: an expense or an income filed
// under it from an account in another currency records the amount in the category's currency too,
// in dest_amount — where a transfer between currencies keeps what arrived — and, converted at a
// rate, follows that rate until its date the same way (dest_amount_as_of).
//
// Only a top-level category holds one; its subcategories are in the same currency. Null is a
// category with none, whose transactions record one amount, as before.
export const addCategoryCurrency: Migration = {
  name: '20261012190000-add-category-currency',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumn('categories', new TableColumn({ name: 'currency_id', type: 'smallint', isNullable: true }));
    await queryRunner.createForeignKey(
      'categories',
      new TableForeignKey({ columnNames: ['currency_id'], referencedTableName: 'currencies', referencedColumnNames: ['id'] }),
    );
    await queryRunner.createCheckConstraint(
      'categories',
      new TableCheck({ name: 'chk_category_currency_top_level', expression: 'currency_id IS NULL OR parent_id IS NULL' }),
    );

    // Until now an expense or an income could be sent with a dest_amount, which was kept and meant
    // nothing. No category has a currency yet, so none of those is a category's amount.
    await queryRunner.query('UPDATE transactions SET dest_amount = NULL WHERE to_account_id IS NULL AND dest_amount IS NOT NULL');
    await queryRunner.dropCheckConstraint('transactions', DEST_AS_OF_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: DEST_AS_OF_CHECK, expression: DEST_AS_OF_AFTER }));
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.query(
      'UPDATE transactions SET dest_amount = NULL, dest_amount_as_of = NULL WHERE to_account_id IS NULL AND dest_amount IS NOT NULL',
    );
    await queryRunner.dropCheckConstraint('transactions', DEST_AS_OF_CHECK);
    await queryRunner.createCheckConstraint('transactions', new TableCheck({ name: DEST_AS_OF_CHECK, expression: DEST_AS_OF_BEFORE }));
    await queryRunner.dropCheckConstraint('categories', 'chk_category_currency_top_level');
    await queryRunner.dropColumn('categories', 'currency_id');
  },
};
