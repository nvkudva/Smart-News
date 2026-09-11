import type { Bias } from '@/lib/sources';
import type { Coverage } from '@/lib/coverage';

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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="label">How it&rsquo;s covered</div>
        <div style={{ fontSize: 11.5, fontWeight: 600, color: 'oklch(0.60 0.014 258)' }}>
          {articleCount} article{articleCount === 1 ? '' : 's'}
        </div>
      </div>

      {rated === 0 ? (
        <p style={{ fontSize: 13, lineHeight: 1.5, color: 'oklch(0.42 0.014 258)' }}>
          None of the outlets on this story carry a lean rating yet.
        </p>
      ) : (
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

          <p style={{ fontSize: 13, lineHeight: 1.5, color: 'oklch(0.42 0.014 258)' }}>
            {rated} rated outlet{rated === 1 ? '' : 's'} ran this
            {unrated > 0 && `, and ${unrated} we have not rated`}.
            {dominant && dominant !== 'centre' && ` Coverage sits almost entirely on the ${dominant}.`}
            {dominant === 'centre' && ' Coverage is almost entirely centre outlets.'}
          </p>

          {missing.length > 0 && missing.length < 3 && (
            <p className="blindspot">
              <strong>Blindspot.</strong> No {missing.map((m) => m === 'centre' ? 'centre' : `${m}-leaning`).join(' or ')}
              {' '}outlet in our list ran this story.
            </p>
          )}
        </>
      )}

      {said.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
