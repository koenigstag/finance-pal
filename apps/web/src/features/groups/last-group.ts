const STORAGE_KEY = 'ft.lastGroupId';

// Remembers which group to open at "/". A convenience only: storage can be unavailable (private
// mode, blocked site data), and then the first group is opened instead.
export function readLastGroupId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastGroupId(groupId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, groupId);
  } catch {
    // Not worth surfacing.
  }
}
