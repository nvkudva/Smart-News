import Link from 'next/link';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { TabBar } from '@/components/TabBar';
import { getByCategory, getByCountry, getByPlace, getCategoryFacets, getPlaceFacets } from '@/lib/library';
import { getPlaces } from '@/lib/places';

export const dynamic = 'force-dynamic';

const REGION = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => { try { return REGION.of(code) ?? code; } catch { return code; } };

export default async function Explore({
  searchParams,
}: { searchParams: Promise<{ category?: string; country?: string; place?: string }> }) {
  const { category, country, place } = await searchParams;

  if (category || country || place) {
    // Place ids are opaque, so the heading comes from the gazetteer's own label
    // rather than from anything read out of the id.
    const [stories, title] = category
      ? [await getByCategory(category), category]
      : place
        ? [await getByPlace(place), (await getPlaces([place]))[0]?.label ?? 'Place']
        : [await getByCountry(country!), countryName(country!)];

    return (
      <>
        <main className="shell">
          <div className="pagehead">
            <Link href="/explore" className="kicker" style={{ textDecoration: 'none' }}>← Explore</Link>
            <h1 style={{ marginTop: 8 }}>{title}</h1>
            <p>{stories.length} {stories.length === 1 ? 'story' : 'stories'} in the last 48 hours</p>
          </div>
          <div className="feed">
            {stories.map((s, i) => <StoryCard key={s.id} story={s} variant={variantFor(s, i)} />)}
          </div>
        </main>
        <TabBar active="explore" />
      </>
    );
  }

  const [categories, places] = await Promise.all([getCategoryFacets(), getPlaceFacets()]);

  return (
    <>
      <main className="shell">
        <div className="pagehead">
          <h1>Explore</h1>
          <p>Everything covered in the last 48 hours, by subject and by place.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="label">Categories</div>
            <div className="tiles">
              {categories.map((c) => (
                <Link key={c.category} href={`/explore?category=${encodeURIComponent(c.category)}`} className="tile">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <h3>{c.category}</h3>
                    <span className="tile__n">{c.stories}</span>
                  </div>
                  {c.lead && <p>{c.lead.headline}</p>}
                </Link>
              ))}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="label">Places</div>
            <div className="chips">
              {places.map((p) => (
                <Link key={p.place_id} href={`/explore?place=${encodeURIComponent(p.place_id)}`} className="chip">
                  {p.label}
                  <span style={{ opacity: 0.5, fontWeight: 500 }}>{p.stories}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
      <TabBar active="explore" />
    </>
  );
}
