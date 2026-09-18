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
  // Every control below seeds its useState from this loader's data, so whatever
  // it holds at mount is what the reader sees for the life of the visit. Kept
  // in the router's match cache, that is the answer from the *start of the
  // previous visit* - the background refetch lands in loaderData and no
  // useState ever reads it again, so a tick made here came back undone. Nothing
  // on this page is worth caching anyway: it is the reader's own row.
  gcTime: 0,
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

/** `<count>-<newest last_seen>`; the second half is when the data was current. */
function syncedAt(stamp: string | null): number | null {
  const ms = Number(stamp?.split('-')[1])
  return Number.isFinite(ms) && ms > 0 ? ms : null
}

const when = (ms: number | null) => (ms === null ? 'never' : new Date(ms).toLocaleString(undefined, {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}))

function Profile() {
  const { prefs, countries, resolved, places, stamp } = Route.useLoaderData()

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
            {/* Places is hidden for now, not removed; see TODO.md. */}
            {false && <PlaceChoice initial={picked} options={places} />}
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

        {/* Which build this is, and which cycle's data it is showing. A service
            worker and a cached store sit between a deploy and the reader, so
            "it is deployed" and "they have it" are different facts. */}
        {/* A service worker and a cached store sit between a deploy and the
            reader, so "it is deployed" and "they have it" are different facts,
            as are "the pipeline ran" and "this page has what it wrote". */}
        <p className="buildstamp">
          Last deployed {when(__BUILD_AT__)} · {__BUILD_SHA__}<br />
          Last data synced {when(syncedAt(stamp))}
        </p>
      </main>
      <TabBar active="profile" />
    </>
  )
}

