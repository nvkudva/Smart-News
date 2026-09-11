'use client';

import { useState, useTransition } from 'react';
import { HIDDEN_KEY } from '@/lib/boot';
import { toggleHiddenAction, toggleInterestAction } from '@/app/actions';
import { prefsChanged } from './prefsChanged';

/**
 * Two closed lists over the same ten categories, answering two questions the
 * old single control conflated.
 *
 * `Interests` ranks: a category in it is weighted up, and one outside it still
 * appears, deliberately — a quarter of the feed is reserved for what the reader
 * has not asked for. `Hidden` removes: those stories are dropped from every
 * ranked surface and the category leaves the strip. A category cannot be both,
 * so each list takes the other's claim back.
 *
 * Folded away behind a summary rather than laid out flat. Twenty chips for ten
 * subjects was the largest thing on a page of otherwise one-line settings, and
 * both answers are short enough to read from the closed row — which is what a
 * settings row is for.
 *
 * Saved on the tick. There is no transaction here for a Save button to commit:
 * each toggle is independent, and the server returns the lists it stored, so
 * the control renders from the answer rather than from a hope.
 */
export function PrefChips(
  { categories, initialPicked, initialHidden }:
  { categories: readonly string[]; initialPicked: string[]; initialHidden: string[] },
) {
  const [picked, setPicked] = useState(initialPicked);
  const [hidden, setHidden] = useState(initialHidden);
  const [pending, start] = useTransition();

  /** The strip is prerendered, so it reads this rather than the prefs row. */
  const apply = (next: { hidden: string[]; categories: string[] }) => {
    setPicked(next.categories);
    setHidden(next.hidden);
    // Comma-delimited on both sides so "India" cannot match "Indian"; empty
    // rather than a bare pair of commas when nothing is hidden.
    const list = next.hidden.length ? `,${next.hidden.join(',')},` : '';
    try { localStorage.setItem(HIDDEN_KEY, list); } catch { /* server still knows */ }
    document.documentElement.dataset.hidden = list;
  };

  const list = (names: string[], empty: string) =>
    names.length ? names.join(', ') : empty;

  return (
    <>
      <details className="setdrop">
        <summary className="setrow">
          <span className="setrow__title">Interests</span>
          <span className="setdrop__value">{list(picked, 'None')}</span>
        </summary>
        <div className="setdrop__body">
          <p>Weighted up in the feed. One story in four is still kept for something you did not pick.</p>
          <div className="setchips">
            {categories.map((c) => (
              <label key={c} className="chip" data-on={picked.includes(c)}>
                <input type="checkbox" checked={picked.includes(c)} disabled={pending}
                       onChange={() => start(async () => { apply(await toggleInterestAction(c)); prefsChanged(); })} />
                {c}
              </label>
            ))}
          </div>
        </div>
      </details>

      <details className="setdrop">
        <summary className="setrow">
          <span className="setrow__title">Hidden</span>
          <span className="setdrop__value">{list(hidden, 'Nothing hidden')}</span>
        </summary>
        <div className="setdrop__body">
          <p>Dropped from the feed and taken out of the category strip.</p>
          <div className="setchips">
            {categories.map((c) => (
              <label key={c} className="chip chip--off" data-on={hidden.includes(c)}>
                <input type="checkbox" checked={hidden.includes(c)} disabled={pending}
                       onChange={() => start(async () => { apply(await toggleHiddenAction(c)); prefsChanged(); })} />
                {c}
              </label>
            ))}
          </div>
        </div>
      </details>
    </>
  );
}
