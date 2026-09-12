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
