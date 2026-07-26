import { TableColumn } from 'typeorm';
import type { QueryRunner } from 'typeorm';
import type { Migration } from './migration.interface.js';

// Nullable on purpose: both are filled in through the onboarding flow (PATCH
// /onboarding/profile), not at profile-creation time, and "is this filled in yet" is exactly
// how OnboardingService.getStatus() decides isOnboarded/missingFields. When a future field
// gets added the same way, existing profiles get it back as NULL and isOnboarded flips to
// false for them too, prompting the same flow again — not just for new registrations.
const NEW_COLUMNS = [
  new TableColumn({ name: 'display_name', type: 'text', isNullable: true }),
  new TableColumn({ name: 'start_day_of_week', type: 'smallint', isNullable: true }),
];

export const addProfileOnboardingFields: Migration = {
  name: '20260726140000-add-profile-onboarding-fields',

  async up({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.addColumns('profiles', NEW_COLUMNS);
  },

  async down({ context: queryRunner }: { context: QueryRunner }) {
    await queryRunner.dropColumns(
      'profiles',
      NEW_COLUMNS.map((c) => c.name),
    );
  },
};
