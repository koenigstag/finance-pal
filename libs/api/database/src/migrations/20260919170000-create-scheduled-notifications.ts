import { Table, TableForeignKey, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Notes a group schedules for a moment that hasn't come yet, sent to its members as notifications
// when it does.
//
// The policies are the ones every group-scoped table has: any member reads, only a non-viewer in
// a group that isn't archived writes. What is different is the sending, which happens for nobody
// — the scheduler acts for no user and has no session — so claiming the due rows goes through the
// SECURITY DEFINER function below, as every other path past row security in this schema does.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'scheduled_notifications',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'group_id', type: 'uuid' },
        { name: 'text', type: 'text' },
        { name: 'send_at', type: 'timestamptz' },
        { name: 'timezone', type: 'text' },
        { name: 'sent_at', type: 'timestamptz', isNullable: true },
        { name: 'created_by', type: 'uuid' },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
      checks: [{ name: 'chk_scheduled_notifications_text', expression: "length(btrim(text)) BETWEEN 1 AND 200" }],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'scheduled_notifications',
    new TableForeignKey({
      columnNames: ['group_id'],
      referencedTableName: 'groups',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }),
  );

  // As on transactions: the note stays if its author leaves the group, because it is the group's.
  await queryRunner.createForeignKey(
    'scheduled_notifications',
    new TableForeignKey({ columnNames: ['created_by'], referencedTableName: 'users', referencedColumnNames: ['id'] }),
  );

  await queryRunner.createIndex(
    'scheduled_notifications',
    new TableIndex({ name: 'idx_scheduled_notifications_group', columnNames: ['group_id'] }),
  );
  // Only what is still to come: the scheduler's index stays small however many have gone out.
  await queryRunner.createIndex(
    'scheduled_notifications',
    new TableIndex({ name: 'idx_scheduled_notifications_due', columnNames: ['send_at'], where: 'sent_at IS NULL' }),
  );

  await queryRunner.query('ALTER TABLE scheduled_notifications ENABLE ROW LEVEL SECURITY');
  await queryRunner.query(`
    CREATE POLICY scheduled_notifications_select ON scheduled_notifications FOR SELECT
    USING (is_group_member(group_id))
  `);
  await queryRunner.query(`
    CREATE POLICY scheduled_notifications_insert ON scheduled_notifications FOR INSERT
    WITH CHECK (can_write_group(group_id))
  `);
  await queryRunner.query(`
    CREATE POLICY scheduled_notifications_delete ON scheduled_notifications FOR DELETE
    USING (can_write_group(group_id))
  `);

  // Takes every note whose moment has come, marks it sent and hands it back — in one statement,
  // so the marking is what claims it. Two instances ticking at once, or a tick overrunning the
  // next, cannot both take the same row: the second waits on the row lock and then finds
  // sent_at no longer NULL, so it returns nothing. A note is therefore sent at most once, which
  // is the right way round for something that buzzes a phone — a crash between the claim and the
  // push loses a reminder, where the other way round would deliver it twice.
  //
  // The group's name comes back with it because the notification is titled with it, and the
  // policy above would hide the group from a connection that belongs to nobody.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION claim_due_notifications(p_now timestamptz)
    RETURNS TABLE (notification_id uuid, group_id uuid, group_name text, body text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      WITH claimed AS (
        UPDATE scheduled_notifications s
        SET sent_at = now()
        WHERE s.sent_at IS NULL AND s.send_at <= p_now
        RETURNING s.id, s.group_id, s.text
      )
      SELECT c.id, c.group_id, g.name, c.text
      FROM claimed c
      JOIN groups g ON g.id = c.group_id
    $$
  `);
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP FUNCTION IF EXISTS claim_due_notifications(timestamptz)');
  // Takes its policies, indexes and foreign keys along.
  await queryRunner.dropTable('scheduled_notifications', true);
}

export const createScheduledNotifications: Migration = {
  name: '20260919170000-create-scheduled-notifications',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
