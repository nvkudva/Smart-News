import { Link } from '@tanstack/react-router';
import type { Story } from '../../shared/types';
import { slug } from '../../shared/taxonomy';

/**
 * The index's two tile shapes. They share a grid, a type scale and a border
 * radius family on purpose: a subject and a place are both ways into the same
 * 48 hours, so the difference between them is carried by the fill — a category
 * says its own hue, a place stays on the page's glass — rather than by a second
 * set of shapes the reader has to learn.
 */

/** The hue slot is keyed on the taxonomy slug, so `data-cat` is what a tile
 *  hands the stylesheet; the facet row only knows the display name. */
export function CategoryTile({ name, stories, lead }: {
  name: string; stories: number; lead: Story | null;
}) {
  return (
    <Link to="/explore" search={{ category: name }}
          className="tile exploretile exploretint" data-cat={slug(name)}>
      <span className="exploretile__top">
        <h3>{name}</h3>
        <span className="tile__n">{stories}</span>
      </span>
      {lead && <p>{lead.headline}</p>}
    </Link>
  );
}

const KIND: Record<string, string> = { city: 'City', admin1: 'Region', country: 'Country' };

/* Gazetteer labels are already qualified — "New Delhi, Delhi, India" — and at
   two tiles to a row the qualifier is what gets ellipsised, leaving every tile
   ending in the same three dots. Splitting it onto the second line keeps the
   name itself whole and puts the qualifier where the kind would otherwise sit. */
const splitLabel = (label: string, kind: string): [string, string] => {
  const i = label.indexOf(',');
  return i < 0 ? [label, KIND[kind] ?? 'Place'] : [label.slice(0, i), label.slice(i + 1).trim()];
};

function Pin() {
  return (
    <svg className="exploreplace__pin" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 1.6c2.4 0 4.3 1.9 4.3 4.3 0 3-3.5 7.2-4.3 8.1-.8-.9-4.3-5.1-4.3-8.1 0-2.4 1.9-4.3 4.3-4.3Z"
            fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="5.9" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function PlaceTile({ placeId, label, kind, stories }: {
  placeId: string; label: string; kind: string; stories: number;
}) {
  const [name, qualifier] = splitLabel(label, kind);
  return (
    <Link to="/explore" search={{ place: placeId }} className="exploreplace"
          title={label}>
      <Pin />
      <span className="exploreplace__name">
        <b>{name}</b>
        <small>{qualifier}</small>
      </span>
      <span className="exploreplace__n">{stories}</span>
    </Link>
  );
}
