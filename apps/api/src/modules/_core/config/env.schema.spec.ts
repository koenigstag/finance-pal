import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'r'.repeat(64),
};

describe('validateEnv', () => {
  it('accepts distinct access and refresh secrets', () => {
    expect(validateEnv(base)).toMatchObject({ JWT_ACCESS_SECRET: base.JWT_ACCESS_SECRET });
  });

  it('requires a refresh secret', () => {
    const { JWT_REFRESH_SECRET: _omitted, ...withoutRefresh } = base;
    expect(() => validateEnv(withoutRefresh)).toThrow(/JWT_REFRESH_SECRET/);
  });

  it('rejects the same value for both secrets', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: base.JWT_ACCESS_SECRET })).toThrow(/must differ/);
  });

  it('rejects short secrets', () => {
    expect(() => validateEnv({ ...base, JWT_REFRESH_SECRET: 'short' })).toThrow();
  });
});
