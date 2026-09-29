/** The category list, shared by the Worker and the pipeline (via src/lib/db.ts). */
export const CATEGORIES = [
  'Politics', 'Governance', 'Crime & Courts', 'Disasters & Accidents',
  'Conflict & Diplomacy', 'Business', 'Technology', 'Science', 'Health',
  'Education', 'Sports', 'Entertainment', 'Climate', 'Others',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * What a reader sees, where it differs from what is stored. The stored value,
 * the slug and the hidden-category prefs all keep the long name, so renaming a
 * label never needs a migration or breaks a saved link.
 */
const LABELS: Partial<Record<string, string>> = { Technology: 'Tech' };

export function label(category: string): string {
  return LABELS[category] ?? category;
}

/**
 * Values the summariser no longer issues but the store still holds. Rows keep
 * their old value until the backfill reaches them, so the reading path has to
 * tolerate one: a cluster carrying a retired category gets no sub-pill and no
 * topic section, and is reached through the scope tabs like anything else.
 */
export const RETIRED_CATEGORIES = ['World', 'India'] as const;
