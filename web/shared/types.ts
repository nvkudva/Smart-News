import type { Bias } from './sources';

/**
 * The shapes that cross the wire.
 *
 * The Worker builds these out of D1 and the client renders them, so both sides
 * need the declarations and neither may reach into the other: worker/lib pulls
 * in the D1 binding, and src/ pulls in the DOM. They lived in feed.ts and
 * places.ts in the Next tree, where a type import from a server module cost
 * nothing because both halves compiled together.
 *
 * Types only. Anything with behaviour belongs beside the half that runs it, or
 * in one of the pure modules next to this file.
 */

export type Story = {
  id: string; headline: string; crux: string; category: string;
  place: string | null; country: string | null;
  place_id: string | null; place_label: string | null;
  importance: number;
  image_url: string | null; image_source: string | null;
  article_count: number; source_count: number;
  first_seen: number; last_seen: number;
  framing_left: string | null; framing_centre: string | null; framing_right: string | null;
  exploration: 0 | 1; exploration_kind: 'category' | 'place' | null;
};

export type Prefs = {
  country: string; categories: string[]; places: string[];
  placeIds: string[]; geoConsent: boolean; geoPlaceId: string | null;
  /**
   * Categories the reader has switched off, which is a different question from
   * the ones they are interested in. `categories` only ever ranked — an
   * unchecked category still appeared, deliberately, because a quarter of the
   * feed is reserved for what the reader has not asked for. This removes.
   */
  hidden: string[];
};

export type Outlet = { source: string; url: string; bias: Bias | null };

export type Article = {
  title: string; url: string; published_at: number;
  source: string; homepage: string; bias: Bias | null;
};

export type PlaceKind = 'city' | 'admin1' | 'country';

export type Place = {
  id: string; kind: PlaceKind; name: string; label: string; country: string;
  admin1_id: string | null; parent_id: string | null;
  lat: number | null; lon: number | null; population: number | null;
};

export type Coverage = {
  /** Distinct outlets per side — outlets, not articles: one paper filing six
   *  times is one voice, and counting articles would let it drown the rest. */
  counts: Record<Bias, number>;
  total: number;
  /** The side holding at least BLINDSPOT_SHARE of the outlets, if any. */
  dominant: Bias | null;
  /** Sides with a rating that ran nothing. Only meaningful once `total` is
   *  large enough that silence is a choice rather than a small sample. */
  missing: Bias[];
  rated: number;
  unrated: number;
};

export type CategoryFacet = {
  category: string; stories: number; sources: number; lead: Story | null;
};

export type PlaceFacet = {
  place_id: string; name: string; label: string; kind: PlaceKind; country: string; stories: number;
};

export type Stats = {
  articles: number; clusters: number; summarised: number;
  sources: number; saved: number; newest: number;
};

/**
 * One payload per page, which is what each route's loader awaits.
 *
 * Named here rather than inferred from the Worker's handlers: the client
 * cannot import those, and a page that renders a shape it did not agree to is
 * the failure this file exists to prevent.
 */
export type LocalPayload = {
  stamp: string | null;
  stories: Story[];
  places: Place[];
  /** prefs.places, and only when nothing canonical resolved - see /local. */
  typed: string[];
  /** Which of `places` the device resolved, so the page can fill that chip in
   *  rather than outline it: the reader did not type it. */
  geoPlaceId: string | null;
};

export type SavedPayload = { stories: (Story & { saved_at: number })[] };

export type ReelsPayload = { stories: Story[]; saved: string[] };

export type ExploreIndex = {
  stamp: string | null;
  categories: CategoryFacet[];
  places: PlaceFacet[];
};

export type ExploreFiltered = {
  stamp: string | null;
  title: string;
  category: string | null;
  stories: Story[];
};

export type ExplorePayload = ExploreIndex | ExploreFiltered;

export type ProfilePayload = {
  prefs: Prefs;
  stats: Stats;
  countries: string[];
  /** The reader's placeIds, resolved through the gazetteer. */
  resolved: Place[];
  /** The places we actually hold stories for, commonest first. The picker
   *  offers these and nothing else: a place no source covers can only ever
   *  produce an empty local feed. */
  places: PlaceFacet[];
  /** The consented geo place, if there is one. */
  geo: Place[];
};

export type StoryPayload = {
  cluster: Story;
  articles: Article[];
  related: Story[];
  coverage: Coverage;
  saved: boolean;
};
