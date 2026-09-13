
import { useRef, useState, useTransition } from 'react';
import { setCountryAction } from '../lib/actions';
import { prefsChanged } from './prefsChanged';

export type CountryOption = { code: string; name: string };

/**
 * Home country, in the one section where it means something.
 *
 * It used to sit in Feed as a two-letter text box, which looked like a profile
 * field and read like one. It is not: National is `c.country = this` and
 * International is its complement, so this single value defines two of the
 * fourteen tabs. The list is the countries we actually hold stories for —
 * offering all 249 would let a reader choose two empty sections.
 *
 * The names arrive as props rather than being resolved here. Intl.DisplayNames
 * reads whichever ICU the runtime carries, and Node's and the browser's do not
 * always agree — one says Czechia where the other says Czech Republic — which
 * is a hydration mismatch, and a mismatch takes every handler on the page down
 * with it.
 *
 * Shaped like Interests and Hidden rather than as a native select: it is the
 * third closed list on this page, and the other two already read as a row
 * naming its own answer that opens into the choices. The row heads itself, so
 * the caller does not wrap it in one.
 */
export function CountryPicker({ country, options }: { country: string; options: CountryOption[] }) {
  const [value, setValue] = useState(country);
  const [pending, start] = useTransition();
  const drop = useRef<HTMLDetailsElement>(null);

  function choose(next: string) {
    setValue(next);
    // One answer, so picking one is the end of the question - unlike Interests,
    // where the reader is expected to tick several before closing it.
    if (drop.current) drop.current.open = false;
    start(async () => { setValue(await setCountryAction(next)); prefsChanged(); });
  }

  const name = options.find((c) => c.code === value)?.name ?? value;

  return (
    <details className="setdrop" ref={drop}>
      <summary className="setrow">
        <span className="setrow__title">Home country</span>
        <span className="setdrop__value">{name}</span>
      </summary>
      <div className="setdrop__body">
        <p>
          National is this country and International is everything else. The
          list holds only countries we are carrying stories for.
        </p>
        <div className="setchips" role="radiogroup" aria-label="Home country">
          {options.map((c) => (
            <button
              key={c.code}
              type="button"
              role="radio"
              aria-checked={c.code === value}
              className="chip"
              data-on={c.code === value}
              disabled={pending}
              onClick={() => choose(c.code)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}
