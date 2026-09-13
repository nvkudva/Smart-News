import { createFileRoute } from '@tanstack/react-router'
import { CATEGORIES } from '../../shared/categories'
import type { ProfilePayload } from '../../shared/types'
import { PageSkeleton } from '../components/PageSkeleton'
import { PlaceChoice, type PickedPlace } from '../components/PlaceChoice'
import { CountryPicker, type CountryOption } from '../components/CountryPicker'
import { ModeControl } from '../components/Mode'
import { PrefChips } from '../components/PrefChips'
import { NavPlacementControl } from '../components/NavPlacement'
import { TabBar } from '../components/TabBar'
import { ThemeControl } from '../components/Theme'
import { load } from '../lib/load'

export const Route = createFileRoute('/profile')({
  loader: ({ abortController }) =>
    load<ProfilePayload>('/api/profile', { signal: abortController.signal }),
  pendingComponent: () => <PageSkeleton title="Profile" tab="profile" />,
  component: Profile,
})

// One instance, not one per render. The note this replaces warned that Node's
// ICU and the browser's disagree often enough to cause a hydration mismatch;
// there is no server render left to mismatch with, so the only reason to hoist
// it now is that constructing a DisplayNames is not free.
const REGION = new Intl.DisplayNames(['en'], { type: 'region' })
const nameOf = (c: string) => {
  try { return REGION.of(c) ?? c } catch { return c }
}

function Profile() {
  const { prefs, countries, resolved, places } = Route.useLoaderData()

  // Anything chosen before this list existed - or typed as plain text back when
  // the control was a search box - stays on show so it can still be unticked.
  const named = new Set(resolved.map((p) => p.name.toLowerCase()))
  const picked: PickedPlace[] = [
    ...resolved.map((p) => ({ id: p.id, name: p.name, label: p.label })),
    ...prefs.places.filter((t) => !named.has(t.toLowerCase()))
      .map((t) => ({ id: null, name: t, label: t })),
  ]

  // The stored country belongs in the list even if we hold nothing filed to it
  // today, or choosing it back would be impossible.
  const options: CountryOption[] = [...new Set([prefs.country, ...countries])]
    .map((code) => ({ code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <main className="shell setpage">
        <div className="pagehead">
          <h1>Profile</h1>
          <p>What the feed is tuned to.</p>
        </div>

        <section className="setsection">
          <h2 className="sethead">Feed tuning</h2>

          <div className="setgroup">
            <PrefChips categories={CATEGORIES} initialPicked={[...prefs.categories]}
                       initialHidden={[...prefs.hidden]} />
            {/* Country and places are the same kind of answer as Interests -
                they order what is already in the feed rather than fetching
                anything - so they are the same control in the same group.
                Under a Location heading they read as a profile field and as a
                request for coverage, which neither of them is. */}
            <CountryPicker country={prefs.country} options={options} />
            <PlaceChoice initial={picked} options={places} />
          </div>

          {/* Each row says what it does inside itself, where the reader is
              deciding. A note under the group repeated three of those four
              sentences from a distance and made the section look longer than
              the four lines it actually is. */}
          <p className="setnote">Everything saves as you tap it.</p>
        </section>

        {/* Location is hidden, not removed. Consent, the nearest-place
            resolution and the gazetteer behind it all work; what does not is
            the promise the row makes - a resolved place only joins the list
            the feed ranks against, which is the same weighting a place picked
            by hand already gets. Until it does something a reader can see,
            asking for their location is asking for more than we spend. The
            row goes back with the feature. */}

        <section className="setsection">
          <h2 className="sethead">Appearance</h2>
          <div className="setgroup">
            <ThemeControl />
            <ModeControl />
            <NavPlacementControl />
          </div>
        </section>
      </main>
      <TabBar active="profile" />
    </>
  )
}

