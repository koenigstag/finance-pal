import { describe, expect, it } from 'vitest';
import { commitUrl, newIssueUrl, shortCommit } from './build-info';

describe('build info', () => {
  it('shortens a hash to the part people read', () => {
    expect(shortCommit('cdc8fdd1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6')).toBe('cdc8fdd');
  });

  it('links a commit to the repository it came from', () => {
    expect(commitUrl('cdc8fdd1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6')).toBe(
      'https://github.com/koenigstag/finance-pal/commit/cdc8fdd1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6',
    );
  });

  it('has nowhere to link when the build recorded no commit', () => {
    expect(commitUrl('')).toBeNull();
  });

  it('opens a report with the build already in it', () => {
    const url = new URL(newIssueUrl('0.0.1', 'cdc8fdd1f0a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6'));

    expect(url.origin + url.pathname).toBe('https://github.com/koenigstag/finance-pal/issues/new');
    expect(url.searchParams.get('body')).toBe('\n\n---\nVersion: 0.0.1 (cdc8fdd)');
  });

  it('reports the version alone when there is no commit to name', () => {
    const url = new URL(newIssueUrl('0.0.1', ''));

    expect(url.searchParams.get('body')).toBe('\n\n---\nVersion: 0.0.1');
  });
});
