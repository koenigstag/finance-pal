import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { queryKeys } from '@/lib/query-keys';
import { rootStore } from '@/stores/root-store';
import { SettingsPage } from './settings-page';

const profile = {
  displayName: 'Sam',
  startDayOfWeek: 1,
  mainCurrencyId: 1,
  language: 'en',
  exchangeRates: null,
};

// Seeded rather than fetched: this is about which tab shows what, not about loading.
const wrapper = (initialEntry: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.profile, profile);
  queryClient.setQueryData(queryKeys.currencies, [{ id: 1, code: 'EUR', name: 'Euro' }]);
  queryClient.setQueryData(queryKeys.groups, []);

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

const renderAt = (initialEntry: string) => render(<SettingsPage />, { wrapper: wrapper(initialEntry) });

describe('SettingsPage', () => {
  beforeEach(() => {
    localStorage.clear();
    rootStore.session.set({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      user: { id: 'u1', email: 'sam@example.com' },
    });
  });

  it('opens on the profile tab, with the other sections a click away', async () => {
    renderAt('/settings');

    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
    expect(screen.getByLabelText('Your name')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();

    // Tabs switch on mouse down, the way Radix activates them; the switch itself goes through
    // the URL, so it waits on the router rather than on component state.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Account' }));

    expect(await screen.findByLabelText('Current password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy();
    expect(screen.queryByLabelText('Your name')).toBeNull();
  });

  it('opens the tab the URL asks for, so a section can be linked to', () => {
    renderAt('/settings?tab=appearance');

    expect(screen.getByRole('tab', { name: 'Appearance', selected: true })).toBeTruthy();
    expect(screen.getByText('Applies to this device only.')).toBeTruthy();
  });

  it('falls back to the first tab when the URL names one that does not exist', () => {
    renderAt('/settings?tab=nonsense');

    expect(screen.getByRole('tab', { name: 'Profile', selected: true })).toBeTruthy();
  });
});
