const LS_KEY = 'ts_user_tags';

const BUILTIN_TAGS = new Set([
  'Study', 'Work', 'Personal', 'Exercise', 'Health', 'Social', 'Errands', 'Other',
]);

/** Returns the list of custom tags the user has previously used. */
export function getUserTags(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/** Persists a tag if it isn't already a built-in suggestion. No-op for duplicates. */
export function saveUserTag(tag: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = tag.trim();
  if (!trimmed || BUILTIN_TAGS.has(trimmed)) return;
  try {
    const existing = getUserTags();
    if (!existing.includes(trimmed)) {
      localStorage.setItem(LS_KEY, JSON.stringify([...existing, trimmed]));
    }
  } catch { /* localStorage unavailable */ }
}
