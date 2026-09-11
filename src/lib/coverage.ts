import { SOURCES, type Bias } from './sources';

/**
 * The bias split behind a story, and the only part of a story's payload the
 * browser has to compute rather than be told.
 *
 * It lives here rather than in feed.ts because that module opens D1 at import
 * time: a client component that wanted this function would have dragged the
 * whole query layer into the bundle to get twenty lines of arithmetic. The
 * input is articles the section already ships, so the answer is derivable
 * wherever those are — server or browser.
 */
export type Coverage = {
  /** Distinct outlets per side — outlets, not articles: one paper filing six
   *  times is one voice, and counting articles would let it drown the rest. */
  counts: Record<Bias, number>;
  total: number;
  /** The side holding at least BLINDSPOT_SHARE of the outlets, if any. */
  dominant: Bias | null;
  /** Sides with a rating that ran nothing. Only meaningful once `total` is
   *  large enough that silence is a choice rather than a small sample. */
  missing: Bias[];
  rated: number;
  unrated: number;
};

const BLINDSPOT_SHARE = 0.75;
const BLINDSPOT_MIN_OUTLETS = 5;

/**
 * A side can only be *missing* from a story if we read enough of that side for
 * its silence to mean anything. We rate 4 right outlets against 25 centre, so
 * "no right-leaning outlet ran this" would fire on most stories and would be a
 * fact about our source list, not about the coverage. Sides below the floor
 * still count in the split bar — they just never generate a blindspot claim.
 */
const MIN_OUTLETS_TO_CLAIM_SILENCE = 5;
const CORPUS: Record<Bias, number> = SOURCES.reduce(
  (acc, s) => { acc[s.bias]++; return acc; },
  { left: 0, centre: 0, right: 0 } as Record<Bias, number>);

export function coverageOf(articles: { source: string; bias: Bias | null }[]): Coverage {
  const bySource = new Map<string, Bias | null>();
  for (const a of articles) if (!bySource.has(a.source)) bySource.set(a.source, a.bias);

  const counts: Record<Bias, number> = { left: 0, centre: 0, right: 0 };
  let unrated = 0;
  for (const bias of bySource.values()) {
    if (bias === 'left' || bias === 'centre' || bias === 'right') counts[bias]++;
    else unrated++;
  }
  const rated = counts.left + counts.centre + counts.right;

  const dominant = (Object.keys(counts) as Bias[]).find(
    (b) => rated >= BLINDSPOT_MIN_OUTLETS && counts[b] / rated >= BLINDSPOT_SHARE) ?? null;

  return {
    counts, total: bySource.size, dominant, rated, unrated,
    missing: rated >= BLINDSPOT_MIN_OUTLETS
      ? (Object.keys(counts) as Bias[]).filter(
          (b) => counts[b] === 0 && CORPUS[b] >= MIN_OUTLETS_TO_CLAIM_SILENCE)
      : [],
  };
}
