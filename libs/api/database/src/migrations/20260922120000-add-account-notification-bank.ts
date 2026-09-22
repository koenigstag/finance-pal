import type { Migration } from './migration.interface.js';

// Which bank's notifications an account receives. The external API records a forwarded
// notification (POST /notifications) on the account naming that notification's bank, so the phone
// forwarding it needn't know the group's accounts. The API holds the value to the banks it can
// read; checking it here as well would take a migration for every bank added there.
export const addAccountNotificationBank: Migration = {
  name: '20260922120000-add-account-notification-bank',

  async up({ context: queryRunner }) {
    await queryRunner.query('ALTER TABLE accounts ADD COLUMN notification_bank text');
  },

  async down({ context: queryRunner }) {
    await queryRunner.query('ALTER TABLE accounts DROP COLUMN notification_bank');
  },
};
