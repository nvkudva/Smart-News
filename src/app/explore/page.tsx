import Link from 'next/link';
import { StoryCard, variantFor } from '@/components/StoryCard';
import { CategoryTile, PlaceTile } from '@/components/ExploreTiles';
import { TabBar } from '@/components/TabBar';
import { getByCategory, getByCountry, getByPlace, getCategoryFacets, getPlaceFacets } from '@/lib/library';
import { getPlaces } from '@/lib/places';
import { slug } from '@/lib/taxonomy';

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
          <div className="pagehead exploretint" data-cat={category ? slug(category) : undefined}>
            <Link href="/explore" className="kicker exploreback">← Explore</Link>
            <h1 className="exploretitle">{title}</h1>
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

        <div className="explorestack">
          <section className="exploresec">
            <div className="label">Categories</div>
            <div className="tiles">
              {categories.map((c) => (
                <CategoryTile key={c.category} name={c.category} stories={c.stories} lead={c.lead} />
              ))}
            </div>
          </section>

          {places.length > 0 && (
            <section className="exploresec">
              <div className="label">Places</div>
              <div className="exploreplaces">
                {places.map((p) => (
                  <PlaceTile key={p.place_id} placeId={p.place_id} label={p.label}
                             kind={p.kind} stories={p.stories} />
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
      <TabBar active="explore" />
    </>
  );
}
