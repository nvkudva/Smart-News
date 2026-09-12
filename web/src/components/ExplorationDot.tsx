
import { useEffect, useRef, useState } from 'react';

/**
 * Marks a story the ranker put in the feed *because* it sits outside the
 * reader's stated interests. It has to be noticeable enough to explain a
 * surprise and quiet enough not to shout — a dot, not a coloured card.
 *
 * The reserve reaches two ways, and the reader is owed the right reason: a
 * subject they did not ask for, or a place next to one they did.
 */
export function ExplorationDot({ kind = 'category' }: { kind?: 'category' | 'place' }) {
  const near = kind === 'place';
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <span className="expdot" ref={ref}>
      <button
        type="button"
        className="expdot__hit"
        aria-label={near ? 'Why am I seeing this? Somewhere near you' : 'Why am I seeing this? Outside your usual interests'}
        title={near ? 'Near a place you follow' : 'Outside your usual interests'}
        aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
      >
        <span className="expdot__dot" />
      </button>
      {open && (
        <span role="tooltip" className="expdot__tip">
          {near
            ? 'Recommended — near a place you follow, but not one of them. One slot in four is kept for something you would not otherwise have seen.'
            : 'Recommended — outside your usual interests. One slot in four is kept for something you would not otherwise have seen.'}
        </span>
      )}
    </span>
  );
}
