import { validateEnv } from './env.schema';

const base = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'a'.repeat(64),
  JWT_REFRESH_SECRET: 'r'.repeat(64),
};

const vapid = {
  VAPID_PUBLIC_KEY: 'B'.repeat(87),
  VAPID_PRIVATE_KEY: 'p'.repeat(43),
  VAPID_SUBJECT: 'mailto:admin@example.com',
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

  it('leaves push notifications off when no VAPID keys are given', () => {
    expect(validateEnv(base).VAPID_PUBLIC_KEY).toBeUndefined();
  });

  it('accepts a whole VAPID set', () => {
    const env = validateEnv({ ...base, ...vapid });

    expect(env.VAPID_SUBJECT).toBe(vapid.VAPID_SUBJECT);
  });

  it('rejects one VAPID key without the other', () => {
    const { VAPID_PRIVATE_KEY: _omitted, ...halfConfigured } = vapid;

    expect(() => validateEnv({ ...base, ...halfConfigured })).toThrow(/must be set together/);
  });

  it('rejects VAPID keys with nobody to contact about them', () => {
    const { VAPID_SUBJECT: _omitted, ...withoutSubject } = vapid;

    expect(() => validateEnv({ ...base, ...withoutSubject })).toThrow(/VAPID_SUBJECT is required/);
  });

  it('rejects a contact that is neither an address nor a URL', () => {
    expect(() => validateEnv({ ...base, ...vapid, VAPID_SUBJECT: 'admin@example.com' })).toThrow(/mailto:/);
  });
});
