/**
 * How a time is written on a card.
 *
 * These lived in StoryCard.tsx, which meant profile.tsx imported a date
 * formatter from a card component in order to say when the newest story
 * arrived. Nothing here renders anything or knows what a card is.
 */

export function ago(ts: number): string {
  const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** A cluster gathering coverage six hours after it broke is still running. */
const running = (s: { first_seen: number; last_seen: number }) =>
  s.last_seen - s.first_seen > 6 * 3_600_000;

/**
 * One time value, for a card foot that has to survive on a single line beside
 * a place name. A running story reports its latest movement and says so — the
 * word is what stops `3h ago` on a three-day-old story reading as breaking —
 * and everything else reports when it broke. The detail page carries both.
 */
export function storyWhen(s: { first_seen: number; last_seen: number }): string {
  return running(s) ? `updated ${ago(s.last_seen)}` : ago(s.first_seen);
}
