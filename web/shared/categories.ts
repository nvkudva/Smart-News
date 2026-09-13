/**
 * The category list, and nothing else.
 *
 * These live in src/lib/db.ts in the Next tree, beside the pipeline's
 * node:sqlite schema. taxonomy.ts wants only the constant, so importing it
 * from there would pull node:sqlite into the Worker bundle for the sake of ten
 * strings. Keep the two lists identical: db.ts remains the source of truth
 * while the pipeline still runs on Node.
 */
export const CATEGORIES = [
  'Politics', 'Governance', 'Crime & Courts', 'Disasters & Accidents',
  'Conflict & Diplomacy', 'Business', 'Technology', 'Science', 'Health',
  'Education', 'Sports', 'Entertainment', 'Climate', 'Others',
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Values the summariser no longer issues but the store still holds. Rows keep
 * their old value until the backfill reaches them, so the reading path has to
 * tolerate one: a cluster carrying a retired category gets no sub-pill and no
 * topic section, and is reached through the scope tabs like anything else.
 */
export const RETIRED_CATEGORIES = ['World', 'India'] as const;
