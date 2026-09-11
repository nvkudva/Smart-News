import Link from 'next/link';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { Pin } from '@/components/icons';
import { effectivePlaceIds, getLocalFeed, getPrefs } from '@/lib/feed';
import { getPlaces } from '@/lib/places';
import { currentUserId } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Local() {
  const uid = await currentUserId();
  const prefs = await getPrefs(uid);
  const [stories, places] = await Promise.all([
    getLocalFeed(30, uid),
    getPlaces(effectivePlaceIds(prefs)),
  ]);

  // getLocalFeed only falls back to the free-text place match when nothing
  // canonical resolved, so the typed names are named in the header exactly when
  // they are the thing selecting the stories below — a reader whose places never
  // resolved sees a populated page with its sources credited, not 'no places'.
  const typed = places.length === 0 ? prefs.places : [];
  const nothingNamed = places.length === 0 && typed.length === 0;

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <Link href="/" className="kicker" style={{ textDecoration: 'none' }}>← Today</Link>
          <h1 style={{ marginTop: 8 }}>Local</h1>
          <p>
            {nothingNamed
              ? 'Follow a place and its news collects here.'
              : stories.length === 0
                ? 'Nothing filed here in the last two days.'
                : `${stories.length} ${stories.length === 1 ? 'story' : 'stories'} from your places, and from anywhere inside them.`}
          </p>
          {!nothingNamed && (
            <div className="chips localhead">
              {/* The place GPS resolved is filled in rather than outlined: the
                  reader did not type it, so it has to be obvious which one the
                  device is responsible for. */}
              {places.map((p) => (
                <span key={p.id} className="chip" data-on={p.id === prefs.geoPlaceId || undefined}
                      title={p.id === prefs.geoPlaceId ? 'From your device location' : p.label}>
                  <span className="localhead__pin"><Pin size={11} /></span>
                  {p.label}
                </span>
              ))}
              {typed.map((t) => (
                <span key={`t:${t}`} className="chip" data-unmatched title={`${t} — matched by name only`}>
                  {t}<span className="chip__note">text</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {stories.length === 0 ? (
          <div className="panel">
            <div className="label">{nothingNamed ? 'No places yet' : 'Quiet so far'}</div>
            <p>
              {!nothingNamed
                ? 'Nothing has been filed from your places in the last two days. The main feed still carries them when they turn up.'
                : 'Add the cities, states or countries you care about and this becomes their front page.'}
            </p>
            <Link href="/profile" className="btn" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
              {nothingNamed ? 'Choose your places' : 'Edit your places'}
            </Link>
          </div>
        ) : (
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        )}
      </main>
      <TabBar active="local" />
    </>
  );
}
