import { authContract, changePasswordSchema } from './auth.contract.js';

describe('changePasswordSchema', () => {
  it('accepts a new password that differs from the current one', () => {
    const body = changePasswordSchema.parse({ currentPassword: 'old', newPassword: 'new-password' });
    expect(body).toEqual({ currentPassword: 'old', newPassword: 'new-password' });
  });

  it('refuses a new password that is the current one', () => {
    const result = changePasswordSchema.safeParse({ currentPassword: 'same-password', newPassword: 'same-password' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['newPassword']);
  });

  it('holds the new password to the same length as registering does', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success).toBe(false);
  });

  it('asks only that the current password was typed, whatever the rules were when it was set', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: 'old', newPassword: 'new-password' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: '', newPassword: 'new-password' }).success).toBe(false);
  });
});

describe('authContract', () => {
  it('answers a wrong current password with 403, leaving 401 to mean an expired token', () => {
    expect(authContract.changePassword.path).toBe('/api/auth/password');
    expect(Object.keys(authContract.changePassword.responses)).toEqual(['200', '403']);
  });
});
