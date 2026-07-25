import type { Migration } from './migration.interface.js';

// (id, code, name, symbol) — ids are arbitrary stable integers for FK purposes within this
// database, not ISO numeric currency codes. Carried over from the original Supabase seed.
const CURRENCIES: ReadonlyArray<[number, string, string, string]> = [
  [1, 'USD', 'US Dollar', '$'],
  [2, 'EUR', 'Euro', '€'],
  [3, 'GBP', 'British Pound', '£'],
  [4, 'RUB', 'Russian Ruble', '₽'],
  [5, 'UAH', 'Ukrainian Hryvnia', '₴'],
  [6, 'KZT', 'Kazakhstani Tenge', '₸'],
  [7, 'PLN', 'Polish Zloty', 'zł'],
  [8, 'CZK', 'Czech Koruna', 'Kč'],
  [9, 'TRY', 'Turkish Lira', '₺'],
  [10, 'CNY', 'Chinese Yuan', '¥'],
  [11, 'JPY', 'Japanese Yen', '¥'],
  [12, 'CHF', 'Swiss Franc', 'CHF'],
  [13, 'GEL', 'Georgian Lari', '₾'],
  [14, 'AMD', 'Armenian Dram', '֏'],
  [15, 'AED', 'UAE Dirham', 'د.إ'],
];

export const seedCurrencies: Migration = {
  name: '20260725220000-seed-currencies',

  async up({ context: queryRunner }) {
    for (const [id, code, name, symbol] of CURRENCIES) {
      await queryRunner.query(
        'INSERT INTO currencies (id, code, name, symbol) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING',
        [id, code, name, symbol],
      );
    }
  },

  async down({ context: queryRunner }) {
    const ids = CURRENCIES.map(([id]) => id);
    await queryRunner.query('DELETE FROM currencies WHERE id = ANY($1)', [ids]);
  },
};
