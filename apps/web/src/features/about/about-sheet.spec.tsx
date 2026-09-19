import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { REPOSITORY_URL, newIssueUrl } from '@/lib/build-info';
import { AboutSheet } from './about-sheet';

// Hoisted with the mock below, which vitest lifts above the imports.
const { COMMIT } = vi.hoisted(() => ({ COMMIT: 'cdc8fdd1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6' }));

// The real values come from the build (see vite.config.mts), so the test brings its own.
vi.mock('@/lib/build-info', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/build-info')>()),
  APP_VERSION: '1.2.3',
  APP_COMMIT: COMMIT,
}));

describe('AboutSheet', () => {
  it('names the build it is running and where that code lives', () => {
    render(<AboutSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByText('1.2.3')).toBeTruthy();

    // The hash is shown short, but the link goes to the whole of it.
    const commit = screen.getByRole('link', { name: 'cdc8fdd' });
    expect(commit.getAttribute('href')).toBe(`${REPOSITORY_URL}/commit/${COMMIT}`);

    const source = screen.getByRole('link', { name: /GitHub/ });
    expect(source.getAttribute('href')).toBe(REPOSITORY_URL);
  });

  it('opens a new issue carrying that same build', () => {
    render(<AboutSheet open onOpenChange={vi.fn()} />);

    const report = screen.getByRole('link', { name: i18n.t('about.reportIssue') });
    expect(report.getAttribute('href')).toBe(newIssueUrl('1.2.3', COMMIT));
  });
});
