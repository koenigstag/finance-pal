import { Table, TableForeignKey, TableIndex } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Devices registered for Web Push, one row per browser per person.
//
// The SECURITY DEFINER functions below come with the table, for the same reason
// authenticate_api_key has one: sending a notification is work done *for* someone other than
// whoever asked. Whoever sets a notification off may not read the recipients' rows, the
// scheduler's notifications are set off by nobody at all, and either way the sending happens
// after the transaction it belongs to has committed, on a connection with no app.current_user_id
// — under the policy below, all of that sees nothing. These functions are the only way past it,
// and none of them takes a device from the outside: they are handed a person, or a group, and a
// topic, and hand back only what has asked to hear about it.
async function up(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.createTable(
    new Table({
      name: 'push_subscriptions',
      columns: [
        { name: 'id', type: 'uuid', isPrimary: true, default: 'gen_random_uuid()' },
        { name: 'user_id', type: 'uuid' },
        { name: 'endpoint', type: 'text', isUnique: true },
        { name: 'p256dh', type: 'text' },
        { name: 'auth', type: 'text' },
        { name: 'topics', type: 'text', isArray: true },
        { name: 'user_agent', type: 'text', isNullable: true },
        { name: 'last_notified_at', type: 'timestamptz', isNullable: true },
        { name: 'created_at', type: 'timestamptz', default: 'now()' },
      ],
    }),
    true,
  );

  await queryRunner.createForeignKey(
    'push_subscriptions',
    new TableForeignKey({
      columnNames: ['user_id'],
      referencedTableName: 'users',
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    }),
  );

  await queryRunner.createIndex(
    'push_subscriptions',
    new TableIndex({ name: 'idx_push_subscriptions_user', columnNames: ['user_id'] }),
  );

  // Your own devices only: nobody sees what anyone else has registered, co-members included.
  await queryRunner.query('ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY');
  await queryRunner.query(`
    CREATE POLICY push_subscriptions_owner ON push_subscriptions FOR ALL
    USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())
  `);

  // Registering a device. A browser hands out one endpoint per profile, and it belongs to
  // whoever is signed in there now: a device that changes hands — someone signed out and someone
  // else signed in, or the first person's sign-out never reached the API — has to be able to
  // register again. Under the policy above the previous owner's row is invisible, so the insert
  // would fail on the unique endpoint with nothing the caller could do about it, forever.
  //
  // Taking it over is the right answer because holding the endpoint and its keys is what being
  // that device means. The identity is still the session's own: p_user_id is checked against
  // app_current_user_id() rather than trusted, so this can only ever register for the caller.
  // A device that changed hands starts its history afresh; the same person re-registering (a
  // topic switched on, a key the browser rotated) keeps theirs.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION claim_push_subscription(
      p_user_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_topics text[], p_user_agent text
    ) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'a push subscription can only be registered for the current user';
      END IF;

      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, topics, user_agent)
      VALUES (p_user_id, p_endpoint, p_p256dh, p_auth, p_topics, p_user_agent)
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = p_user_id,
        p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth,
        topics = EXCLUDED.topics,
        user_agent = EXCLUDED.user_agent,
        created_at = CASE WHEN push_subscriptions.user_id = p_user_id THEN push_subscriptions.created_at ELSE now() END,
        last_notified_at = CASE WHEN push_subscriptions.user_id = p_user_id THEN push_subscriptions.last_notified_at ELSE NULL END;
    END;
    $$
  `);

  // Who to send a notification to, and in which language. Rows for the given people only, and
  // only devices that asked for this topic; a NULL topic means every device they have, which is
  // what the "does push reach this device" test sends to.
  //
  // The profile join is part of why this needs to be a definer function at all: profiles are
  // visible to their owner and nobody else, and a notification has to read right in the language
  // of whoever receives it, not whoever set it off.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION find_push_targets(p_user_ids uuid[], p_topic text)
    RETURNS TABLE (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, language text)
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, COALESCE(p.language, 'en')
      FROM push_subscriptions s
      LEFT JOIN profiles p ON p.id = s.user_id
      WHERE s.user_id = ANY(p_user_ids)
        AND (p_topic IS NULL OR p_topic = ANY(s.topics))
    $$
  `);

  // The same for a whole group. Membership is what makes someone a recipient, so this reads
  // group_members itself instead of being handed a list: the one thing sent this way comes from
  // the scheduler, which acts for nobody and has no session whose membership Postgres could
  // check a list against.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION find_group_push_targets(p_group_id uuid, p_topic text)
    RETURNS TABLE (subscription_id uuid, user_id uuid, endpoint text, p256dh text, auth text, language text)
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path = public, pg_temp
    AS $$
      SELECT s.id, s.user_id, s.endpoint, s.p256dh, s.auth, COALESCE(p.language, 'en')
      FROM push_subscriptions s
      JOIN group_members m ON m.user_id = s.user_id AND m.group_id = p_group_id
      LEFT JOIN profiles p ON p.id = s.user_id
      WHERE p_topic IS NULL OR p_topic = ANY(s.topics)
    $$
  `);

  // What the push service said. A device that is gone — the app was uninstalled, the browser
  // dropped the subscription, the permission was revoked — is deleted rather than retried
  // forever; anything else records that the service took it.
  await queryRunner.query(`
    CREATE OR REPLACE FUNCTION record_push_delivery(p_subscription_id uuid, p_gone boolean)
    RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      DELETE FROM push_subscriptions WHERE id = p_subscription_id AND p_gone;
      UPDATE push_subscriptions SET last_notified_at = now() WHERE id = p_subscription_id AND NOT p_gone;
    $$
  `);
}

async function down(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query('DROP FUNCTION IF EXISTS record_push_delivery(uuid, boolean)');
  await queryRunner.query('DROP FUNCTION IF EXISTS find_group_push_targets(uuid, text)');
  await queryRunner.query('DROP FUNCTION IF EXISTS find_push_targets(uuid[], text)');
  await queryRunner.query('DROP FUNCTION IF EXISTS claim_push_subscription(uuid, text, text, text, text[], text)');
  // Takes its policy, index and foreign key along.
  await queryRunner.dropTable('push_subscriptions', true);
}

export const createPushSubscriptions: Migration = {
  name: '20260919160000-create-push-subscriptions',

  async up({ context: queryRunner }) {
    await up(queryRunner);
  },

  async down({ context: queryRunner }) {
    await down(queryRunner);
  },
};
