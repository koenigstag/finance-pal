import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { api } from '@/lib/api/client';
import { rootStore } from '@/stores/root-store';
import { ChangePasswordCard } from './change-password-card';

const session = { accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1', email: 'a@example.com' } };

const fill = (values: { current: string; next: string; confirm: string }) => {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: values.current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: values.next } });
  fireEvent.change(screen.getByLabelText('Repeat new password'), { target: { value: values.confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
};

describe('ChangePasswordCard', () => {
  const changePassword = vi.spyOn(api.auth, 'changePassword');

  beforeEach(() => {
    localStorage.clear();
    changePassword.mockReset();
    rootStore.session.set(session);
    render(<ChangePasswordCard />);
  });

  it('changes the password and keeps this device signed in with the tokens it gets back', async () => {
    changePassword.mockResolvedValue({
      status: 200,
      body: { accessToken: 'access-2', refreshToken: 'refresh-2' },
    } as never);

    fill({ current: 'old-password', next: 'new-password', confirm: 'new-password' });

    await waitFor(() => expect(changePassword).toHaveBeenCalledTimes(1));
    expect(changePassword.mock.calls[0][0]).toMatchObject({
      body: { currentPassword: 'old-password', newPassword: 'new-password' },
    });
    // Everything issued before the change is revoked, this tab's pair included.
    expect(rootStore.session.session).toEqual({ ...session, accessToken: 'access-2', refreshToken: 'refresh-2' });
    expect(await screen.findByText(/Password changed/)).toBeTruthy();
  });

  it('puts a wrong current password on its own field and leaves the session alone', async () => {
    changePassword.mockResolvedValue({ status: 403, body: { message: 'Current password is incorrect' } } as never);

    fill({ current: 'not-the-password', next: 'new-password', confirm: 'new-password' });

    expect(await screen.findByText('Wrong current password.')).toBeTruthy();
    expect(rootStore.session.session).toEqual(session);
  });

  it("doesn't send a new password that was repeated wrongly", async () => {
    fill({ current: 'old-password', next: 'new-password', confirm: 'new-pasword' });

    expect(await screen.findByText("The passwords don't match.")).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("doesn't send a new password that is the current one", async () => {
    fill({ current: 'old-password', next: 'old-password', confirm: 'old-password' });

    expect(await screen.findByText('Choose a password different from the current one.')).toBeTruthy();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
