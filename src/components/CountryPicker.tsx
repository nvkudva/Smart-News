'use client';

import { useState, useTransition } from 'react';
import { setCountryAction } from '@/app/actions';
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
 */
export function CountryPicker({ country, options }: { country: string; options: CountryOption[] }) {
  const [value, setValue] = useState(country);
  const [pending, start] = useTransition();

  return (
    <select className="setinput setselect" value={value} disabled={pending}
            aria-label="Home country"
            onChange={(e) => {
              const next = e.target.value;
              setValue(next);
              start(async () => { setValue(await setCountryAction(next)); prefsChanged(); });
            }}>
      {options.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
    </select>
  );
}
