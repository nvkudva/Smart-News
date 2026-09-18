
import { useState, useTransition } from 'react';
import { setCountryAction } from '../lib/actions';
import { prefsChanged } from './prefsChanged';

export type CountryOption = { code: string; name: string };

/**
 * Home country, in the one section where it means something.
 *
 * National is `c.country = this` and International is its complement, so this
 * single value defines two of the fourteen tabs. The list is the countries we
 * actually hold stories for - offering all 249 would let a reader choose two
 * empty sections.
 *
 * The names arrive as props rather than being resolved here. Intl.DisplayNames
 * reads whichever ICU the runtime carries, and Node's and the browser's do not
 * always agree, which is a hydration mismatch.
 *
 * A native select rather than a row of chips: one answer from a long closed
 * list, and the platform's own picker is the shortest way to pick it.
 */
export function CountryPicker({ country, options }: { country: string; options: CountryOption[] }) {
  const [value, setValue] = useState(country);
  const [pending, start] = useTransition();

  function choose(next: string) {
    setValue(next);
    start(async () => { setValue(await setCountryAction(next)); prefsChanged(); });
  }

  return (
    <label className="setrow setrow--select">
      <span className="setrow__title">Home country</span>
      <select
        className="setrow__select"
        value={value}
        disabled={pending}
        onChange={(e) => choose(e.target.value)}
      >
        {options.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </label>
  );
}
