import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { queryKeys } from '@/lib/query-keys';
import { rootStore } from '@/stores/root-store';
import { DataSheet } from './data-sheet';
import { DATA_FILES_DOCS_URL } from './finance-pal-import';
import { fileNameOf } from './queries';

const groups = [
  { id: 'g1', name: 'Family', ownerId: 'u1', archivedAt: null, role: 'owner' },
  { id: 'g2', name: 'Семья', ownerId: 'u1', archivedAt: null, role: 'owner' },
];

// Seeded rather than fetched: the groups are only there to be picked from.
const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  queryClient.setQueryData(queryKeys.groups, groups);
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
};

const fetchMock = vi.fn<typeof fetch>();
// What the browser was asked to save, by the name it was to save it under.
const saved: string[] = [];

describe('DataSheet', () => {
  beforeEach(() => {
    localStorage.clear();
    rootStore.session.set({ accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'u1', email: 'sam@example.com' } });
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    saved.length = 0;
    // jsdom can't make a URL of a blob, nor save one.
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openAt = (option: RegExp) => {
    render(<DataSheet open onOpenChange={vi.fn()} currentGroupId="g2" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: option }));
  };

  it('exports the group the app is on as a workbook, saved under the name the API gives it', async () => {
    fetchMock.mockResolvedValue(
      new Response('workbook', {
        headers: { 'content-disposition': "attachment; filename=\"_____ 2026-09-21.xlsx\"; filename*=UTF-8''%D0%A1%D0%B5%D0%BC%D1%8C%D1%8F%202026-09-21.xlsx" },
      }),
    );
    openAt(/^Export/);
    // The group the app is on, among the others.
    expect(screen.getByRole('combobox', { name: 'Group' }).textContent).toBe('Семья');

    fireEvent.click(screen.getByRole('button', { name: 'Download .xlsx' }));

    await waitFor(() => expect(saved).toEqual(['Семья 2026-09-21.xlsx']));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/api\/groups\/g2\/export\?format=xlsx&timezone=/);
    expect(init?.headers).toEqual({ authorization: 'Bearer access-1' });
  });

  it('exports the same tables as CSV files, in one .zip', async () => {
    fetchMock.mockResolvedValue(new Response('zip', { headers: { 'content-disposition': 'attachment; filename="Family 2026-09-21.zip"' } }));
    openAt(/^Export/);

    fireEvent.click(screen.getByRole('button', { name: 'Download .zip' }));

    await waitFor(() => expect(saved).toEqual(['Family 2026-09-21.zip']));
    expect(fetchMock.mock.calls[0][0]).toMatch(/^\/api\/groups\/g2\/export\?format=csv&timezone=/);
  });

  it('imports a workbook, a .zip or several CSV files at once, and says everything wrong with them', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        {
          statusCode: 400,
          message: ['Transactions, row 3: Amount is empty', 'Transactions, row 7: There\'s no account named "Cahs" in the Accounts table'],
        },
        { status: 400 },
      ),
    );
    openAt(/^Import/);
    fireEvent.click(screen.getByRole('button', { name: /^Finance Pal/ }));

    expect(screen.getByRole('link', { name: 'What goes in each column' }).getAttribute('href')).toBe(DATA_FILES_DOCS_URL);
    const input = screen.getByLabelText('Workbook, .zip or CSV files') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    for (const extension of ['.xlsx', '.zip', '.csv']) {
      expect(input.accept).toContain(extension);
    }

    const files = [new File(['a'], 'Family transactions.csv'), new File(['b'], 'Family accounts.csv')];
    fireEvent.change(input, { target: { files } });
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'Transactions, row 3: Amount is empty\nTransactions, row 7: There\'s no account named "Cahs" in the Accounts table',
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/^\/api\/import\/finance-pal\?timezone=/);
    expect((init?.body as FormData).getAll('file')).toHaveLength(2);
  });
});

describe('fileNameOf', () => {
  it('prefers the UTF-8 name, and falls back to the plain one', () => {
    expect(fileNameOf("attachment; filename=\"a.xlsx\"; filename*=UTF-8''%D0%B0.xlsx")).toBe('а.xlsx');
    expect(fileNameOf('attachment; filename="Family 2026-09-21.xlsx"')).toBe('Family 2026-09-21.xlsx');
    expect(fileNameOf("attachment; filename=\"b.csv\"; filename*=UTF-8''%E0%A4%A")).toBe('b.csv');
    expect(fileNameOf(null)).toBeNull();
  });
});
