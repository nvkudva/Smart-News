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
  'World', 'India', 'Politics', 'Business', 'Technology',
  'Science', 'Health', 'Sports', 'Entertainment', 'Climate',
] as const;

export type Category = (typeof CATEGORIES)[number];
