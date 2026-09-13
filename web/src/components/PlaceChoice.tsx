import { useRef, useState, useTransition } from 'react';
import type { PlaceFacet } from '../../shared/types';
import { setPlacesAction } from '../lib/actions';
import { prefsChanged } from './prefsChanged';

export type PickedPlace = { id: string | null; name: string; label: string };

const MAX = 12;

/**
 * Places, chosen from the ones we actually have news for.
 *
 * The predecessor was a search box over the whole gazetteer, which read as a
 * request for coverage and could not be one: nothing on the ingest side reads
 * a reader's preferences, so a place only ever filters the clusters the fixed
 * source list already produced. Ask for a city no outlet files from and /local
 * is empty with nothing said about why. Offering the places that appear in the
 * last two days of stories makes that impossible to ask for.
 *
 * It sits in Feed rather than under a heading of its own because it does what
 * Interests does - weight what is already there - and it is shaped like them
 * for the same reason.
 */
export function PlaceChoice(
  { initial, options }: { initial: PickedPlace[]; options: PlaceFacet[] },
) {
  const [picked, setPicked] = useState<PickedPlace[]>(initial);
  const [pending, start] = useTransition();
  const drop = useRef<HTMLDetailsElement>(null);

  // A place chosen before this list existed - or typed as free text back when
  // the box was a search - stays on offer, so it can still be unticked.
  const known = new Set(options.map((o) => o.place_id));
  const extra = picked.filter((p) => !p.id || !known.has(p.id));

  const store = (list: PickedPlace[]) => {
    setPicked(list);
    start(async () => {
      await setPlacesAction(
        list.map((p) => p.name),
        list.filter((p) => p.id).map((p) => p.id as string),
      );
      prefsChanged();
    });
  };

  const toggle = (p: PickedPlace) => {
    const on = picked.some((c) => (p.id ? c.id === p.id : c.name === p.name));
    if (on) return store(picked.filter((c) => (p.id ? c.id !== p.id : c.name !== p.name)));
    if (picked.length >= MAX) return;
    store([...picked, p]);
  };

  const on = (p: PickedPlace) => picked.some((c) => (p.id ? c.id === p.id : c.name === p.name));
  const full = picked.length >= MAX;

  const rows: PickedPlace[] = [
    ...extra,
    ...options.map((o) => ({ id: o.place_id, name: o.name, label: o.label })),
  ];

  return (
    <details className="setdrop" ref={drop}>
      <summary className="setrow">
        <span className="setrow__title">Places</span>
        <span className="setdrop__value">
          {picked.length ? picked.map((p) => p.name).join(', ') : 'Anywhere'}
        </span>
      </summary>
      <div className="setdrop__body">
        <p>
          Weighted up in the feed, and what Local shows. Only places we are
          carrying stories for in the last two days, commonest first.
        </p>
        <div className="setchips setchips--wide">
          {rows.map((p) => (
            <label key={p.id ?? `t:${p.name}`} className="chip" data-on={on(p)}
                   data-unmatched={p.id === null || undefined}
                   title={p.id ? p.label : `${p.name} — matched by name only`}>
              <input type="checkbox" checked={on(p)}
                     disabled={pending || (!on(p) && full)}
                     onChange={() => toggle(p)} />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </div>
    </details>
  );
}
