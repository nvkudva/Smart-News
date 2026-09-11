'use client';

import { useEffect, useRef, useState } from 'react';
import { searchPlacesAction, setPlacesAction } from '@/app/actions';
import { prefsChanged } from './prefsChanged';
import type { Place } from '@/lib/places';

export type PickedPlace = { id: string | null; name: string; label: string };

const MAX = 12;

/**
 * Replaces the raw comma-separated box. Two fields leave the form: the canonical
 * `place_ids`, which is what the local feed and the nearby exploration slot read,
 * and the human `places` text, which still carries anything the reader typed that
 * the gazetteer could not resolve — so the feature degrades to the old behaviour
 * rather than losing the place.
 */
export function PlacePicker({ initial }: { initial: PickedPlace[] }) {
  const [picked, setPicked] = useState<PickedPlace[]>(initial);

  /** Saved on the change rather than on a submit: there is no longer a form
   *  around this, and a place added is a place the reader meant to add. */
  const store = (list: PickedPlace[]) => {
    void setPlacesAction(
      list.map((p) => p.name),
      list.filter((p) => p.id).map((p) => p.id as string),
    ).then(prefsChanged).catch(() => {});
    return list;
  };
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const term = q.trim();

  useEffect(() => {
    if (term.length < 2) { setResults([]); setSearching(false); return; }
    let live = true;
    setSearching(true);
    // Debounced: a round trip per keystroke is a round trip to D1 per keystroke.
    const t = setTimeout(() => {
      searchPlacesAction(term)
        .then((r) => { if (live) { setResults(r); setOpen(true); } })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 220);
    return () => { live = false; clearTimeout(t); };
  }, [term]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  function add(next: PickedPlace) {
    setPicked((cur) => {
      if (cur.length >= MAX) return cur;
      const dup = next.id
        ? cur.some((p) => p.id === next.id)
        : cur.some((p) => p.name.toLowerCase() === next.name.toLowerCase());
      return dup ? cur : store([...cur, next]);
    });
    setQ(''); setResults([]); setOpen(false);
  }

  const full = picked.length >= MAX;
  const ids = picked.map((p) => p.id).filter((id): id is string => id !== null);
  // The scorer substring-matches this against the cluster's own free text, so it
  // carries the bare name, never the display label.
  const text = picked.map((p) => p.name).join(', ');

  return (
    <div className="field picker" ref={box}>
      <label htmlFor="place-q">Places you care about</label>

      {picked.length > 0 && (
        <div className="chips">
          {/* A chip the gazetteer knows is solid ink; one it does not is outlined
              and says so, because the two behave differently — only the first
              reaches down the hierarchy to the towns inside it. */}
          {picked.map((p) => (
            <span key={p.id ?? `t:${p.name}`} className="chip" data-on={p.id !== null}
                  data-unmatched={p.id === null || undefined}
                  title={p.id ? p.label : `${p.name} — matched by name only`}>
              {p.label}
              {p.id === null && <span className="chip__note">text</span>}
              <button type="button" className="chip__x" aria-label={`Remove ${p.label}`}
                      onClick={() => setPicked((cur) => store(cur.filter((c) => c !== p)))}>×</button>
            </span>
          ))}
        </div>
      )}

      <div className="picker__box">
        <input
          id="place-q" type="text" value={q} autoComplete="off" spellCheck={false}
          role="combobox" aria-expanded={open && results.length > 0} aria-controls="place-results"
          aria-autocomplete="list" disabled={full}
          placeholder={full ? 'Twelve places is the limit' : 'Search a city, state or country'}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return; }
            if (e.key !== 'Enter') return;
            // The picker lives inside the preferences form; Enter here means
            // "take this place", never "submit everything".
            e.preventDefault();
            if (results.length > 0) add({ id: results[0].id, name: results[0].name, label: results[0].label });
            else if (term.length > 0) add({ id: null, name: term, label: term });
          }}
        />
        {open && term.length >= 2 && (results.length > 0 ? (
          <ul id="place-results" role="listbox" className="picker__menu">
            {results.map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <button type="button" className="picker__opt"
                        onClick={() => add({ id: r.id, name: r.name, label: r.label })}>
                  <span className="picker__opt-n">{r.name}</span>
                  <span className="picker__opt-l">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="picker__menu picker__empty" role="status">
            {searching ? 'Looking…' : 'No place by that name. Press Enter to keep it as plain text.'}
          </div>
        ))}
      </div>

      <p className="hint">
        A story placed inside one of these counts for it — Whitefield counts as
        Bengaluru, Bengaluru counts as Karnataka.
      </p>

    </div>
  );
}
