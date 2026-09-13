import type { Bias } from '../../shared/sources';
import type { Coverage } from '../../shared/types';

const SIDES: { key: Bias; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'centre', label: 'Centre' },
  { key: 'right', label: 'Right' },
];

/**
 * How a story was covered, not what it says: the proportion of outlets on each
 * side, one sentence per side on what those outlets foregrounded, and a
 * blindspot line when one side holds three quarters of the coverage.
 *
 * The ratings behind this are the project's own and the source list leans
 * left-of-centre (9/25/4), so the panel says "of the outlets we read" rather
 * than implying it has surveyed the press.
 */
export function CoverageSplit({
  coverage, framing, articleCount,
}: {
  coverage: Coverage;
  framing: Record<Bias, string | null>;
  articleCount: number;
}) {
  const { counts, rated, unrated, dominant, missing } = coverage;
  const said = SIDES.filter((s) => framing[s.key]);

  return (
    <div className="panel">
      {/* One line: the heading, the bar, the legend and the counts. The bar is
          the only part with no natural width, so it takes whatever the other
          three leave and the row reads as a single measurement rather than as
          four stacked pieces of one. It wraps in order when there is not
          enough width for that, which is what the phone gets. */}
      <div className="split__head">
        <div className="label">How it&rsquo;s covered</div>

        {rated > 0 && (
          <>
            <div className="split" role="img"
                 aria-label={SIDES.map((s) => `${counts[s.key]} ${s.label.toLowerCase()}`).join(', ')}>
              {SIDES.map((s) => counts[s.key] > 0 && (
                <span key={s.key} className="split__seg" data-side={s.key}
                      style={{ flexGrow: counts[s.key] }} />
              ))}
            </div>

            <div className="split__keys">
              {SIDES.map((s) => (
                <span key={s.key} className="split__key" data-on={counts[s.key] > 0}>
                  <i className="split__dot" data-side={s.key} />
                  {s.label} {counts[s.key]}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="split__count">
          {articleCount} article{articleCount === 1 ? '' : 's'}
          {rated > 0 && <> &middot; {rated} rated</>}
          {unrated > 0 && <> &middot; {unrated} unrated</>}
        </div>
      </div>

      {rated === 0 ? (
        <p className="split__note">None of the outlets on this story carry a lean rating yet.</p>
      ) : (
        <>
          {dominant && (
            <p className="split__note">
              {dominant === 'centre'
                ? 'Coverage is almost entirely centre outlets.'
                : `Coverage sits almost entirely on the ${dominant}.`}
            </p>
          )}

          {missing.length > 0 && missing.length < 3 && (
            <p className="blindspot">
              <strong>Blindspot.</strong> No {missing.map((m) => m === 'centre' ? 'centre' : `${m}-leaning`).join(' or ')}
              {' '}outlet in our list ran this story.
            </p>
          )}
        </>
      )}

      {/* One card, not two. The framing was lifted out so it could sit three
          abreast, which a 320px rail beside the meter could not do - but the
          two are one thought: how a story was covered, and what each side made
          of it. The card is full width now and the columns fit inside it. */}
      {/* No heading over the columns either. Inside this card three coloured
          columns headed LEFT, CENTRE and RIGHT are self-evidently the three
          sides, and a title for them was a second title inside a panel that
          already has one. */}
      {said.length > 0 && (
        <div className="story__framings">
          {said.map((s) => (
            <div key={s.key} className="framing">
              <span className="framing__side" data-side={s.key}>{s.label}</span>
              <p>{framing[s.key]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
