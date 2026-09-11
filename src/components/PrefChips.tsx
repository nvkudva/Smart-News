'use client';

import { useState, useTransition } from 'react';
import { HIDDEN_KEY } from '@/lib/boot';
import { toggleHiddenAction, toggleInterestAction } from '@/app/actions';

/**
 * Two closed lists over the same ten categories, answering two questions the
 * old single control conflated.
 *
 * `Interests` ranks: a category in it is weighted up, and one outside it still
 * appears, deliberately — a quarter of the feed is reserved for what the reader
 * has not asked for. `Hidden` removes: those stories are dropped from every
 * ranked surface and the category leaves the strip. A category cannot be both,
 * so hiding one un-picks it.
 *
 * Saved on the tap. There is no transaction here for a Save button to commit —
 * each toggle is independent and the server returns the list it stored, so the
 * control renders from the answer rather than from a hope.
 */
export function PrefChips(
  { categories, initialPicked, initialHidden }:
  { categories: readonly string[]; initialPicked: string[]; initialHidden: string[] },
) {
  const [picked, setPicked] = useState(initialPicked);
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, start] = useTransition();

  /** The strip is prerendered, so it reads this rather than the prefs row. */
  const mirror = (list: string[]) => {
    try { localStorage.setItem(HIDDEN_KEY, `,${list.join(',')},`); } catch { /* server still knows */ }
    document.documentElement.dataset.hidden = `,${list.join(',')},`;
  };

  return (
    <>
      <div className="panel">
        <div className="label">Interests</div>
        <p>Weighted up in the feed. One story in four is still kept for something you did not pick.</p>
        <div className="setchips">
          {categories.filter((c) => !hidden.includes(c)).map((c) => (
            <button key={c} type="button" className="chip" data-on={picked.includes(c)}
                    disabled={pending} aria-pressed={picked.includes(c)}
                    onClick={() => start(async () => setPicked(await toggleInterestAction(c)))}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="label">Hidden</div>
        <p>Dropped from the feed and taken out of the category strip.</p>
        <div className="setchips">
          {categories.map((c) => (
            <button key={c} type="button" className="chip chip--off" data-on={hidden.includes(c)}
                    disabled={pending} aria-pressed={hidden.includes(c)}
                    onClick={() => start(async () => {
                      const next = await toggleHiddenAction(c);
                      setHidden(next.hidden);
                      setPicked(next.categories);
                      mirror(next.hidden);
                    })}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
