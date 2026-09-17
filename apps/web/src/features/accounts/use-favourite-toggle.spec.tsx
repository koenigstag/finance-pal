import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { queryKeys } from '@/lib/query-keys';
import type { Account } from './queries';
import { useFavouriteToggle } from './use-favourite-toggle';

const groupId = 'group-1';
const key = queryKeys.accounts(groupId);

const account = (id: string, isFavourite = false) => ({ id, isFavourite }) as Account;

describe('useFavouriteToggle', () => {
  let queryClient: QueryClient;
  const update = vi.spyOn(api.accounts, 'update');

  const setup = (accounts: Account[]) => {
    queryClient = new QueryClient();
    queryClient.setQueryData(key, accounts);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(() => useFavouriteToggle(groupId), { wrapper }).result;
  };
  const favourites = () => queryClient.getQueryData<Account[]>(key)?.filter((a) => a.isFavourite).map((a) => a.id);

  beforeEach(() => {
    vi.useFakeTimers();
    update.mockReset();
    update.mockResolvedValue({ status: 200, body: {} } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates the list at once and saves once, after clicking stops', async () => {
    const toggle = setup([account('a', true), account('b')]);

    act(() => toggle.current('b'));
    expect(favourites()).toEqual(['b']);
    expect(update).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ params: { accountId: 'b' }, body: { isFavourite: true } });
  });

  it('sends only the final state of rapid clicks', async () => {
    const toggle = setup([account('a'), account('b')]);

    act(() => toggle.current('b'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    act(() => toggle.current('b'));
    await act(() => vi.advanceTimersByTimeAsync(200));
    act(() => toggle.current('b'));
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ body: { isFavourite: true } });
  });

  it('sends nothing and restores the list when clicks end where they started', async () => {
    const toggle = setup([account('a', true), account('b')]);

    act(() => toggle.current('b')); // b starred, a cleared
    act(() => toggle.current('b')); // b unstarred again
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(update).not.toHaveBeenCalled();
    expect(favourites()).toEqual(['a']);
  });

  it('puts the list back when the save fails', async () => {
    update.mockResolvedValue({ status: 500, body: {} } as never);
    const toggle = setup([account('a', true), account('b')]);

    act(() => toggle.current('b'));
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(favourites()).toEqual(['a']);
  });

  it("saves one account's burst right away when another account is clicked", async () => {
    const toggle = setup([account('a'), account('b'), account('c')]);

    act(() => toggle.current('b'));
    act(() => toggle.current('c'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toMatchObject({ params: { accountId: 'b' } });

    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1][0]).toMatchObject({ params: { accountId: 'c' }, body: { isFavourite: true } });
  });
});
