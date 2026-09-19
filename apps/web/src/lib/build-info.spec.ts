import { describe, expect, it } from 'vitest';
import { commitUrl, shortCommit } from './build-info';

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
});
