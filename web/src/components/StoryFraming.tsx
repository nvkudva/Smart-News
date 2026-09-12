import type { Bias } from '../../shared/sources';

const SIDES: { key: Bias; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'centre', label: 'Centre' },
  { key: 'right', label: 'Right' },
];

/**
 * The framing paragraphs, lifted out of the coverage panel so they can sit
 * three abreast. Stacked in a 320px rail a reader takes them one at a time,
 * which is the one thing they are not for: the point is the comparison, and
 * that only happens when the three are on screen beside each other.
 */
export function StoryFraming({ framing }: { framing: Record<Bias, string | null> }) {
  const said = SIDES.filter((s) => framing[s.key]);
  if (said.length === 0) return null;

  return (
    <section className="story__sides">
      <h2 className="sectitle">How each side told it</h2>
      <div className="story__framings">
        {said.map((s) => (
          <div key={s.key} className="framing">
            <span className="framing__side" data-side={s.key}>{s.label}</span>
            <p>{framing[s.key]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
