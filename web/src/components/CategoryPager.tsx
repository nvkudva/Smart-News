
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { SectionFeed } from './SectionFeed';

export type PagerSection = { slug: string; name: string };


/** Past this fraction of the pane the release commits rather than snaps back. */
const COMMIT = 0.28;
/** …unless the finger was moving fast enough that distance stops mattering. */
const FLICK_PX_PER_MS = 0.45;
/** Pull at a dead end still moves, but a third as far, so the edge is felt. */
const RUBBER = 3;
/** Long enough to read as travel, short enough that the URL is not late. */
const SETTLE_MS = 280;
const EASE = 'cubic-bezier(.22,.7,.25,1)';
/** Set the first time the hint plays, so it is a hint and not a habit. */
const NUDGED = 'sn_swipe_hint';

/**
 * Three panes on one track: the previous category, the current one, the next.
 * The track is what moves, so a swipe is a single transform on a single element
 * and the neighbour is already on screen when the finger reaches it.
 *
 * The predecessor translated the live page and then navigated, which meant the
 * outgoing feed sat under the finger until the route committed and the incoming
 * one jumped in from a fixed offset — a visible discontinuity at exactly the
 * moment the gesture is promising continuity. Here the navigation happens after
 * the movement is over and the window has been re-centred, so `router.replace`
 * has nothing left to animate and only has to make the URL and the strip's
 * highlight agree with what is already on screen.
 *
 * The category strip is deliberately not on the track: it is the page's title
 * bar, and it stays fixed while the feed under it travels.
 *
 * Deliberately touch-only. A trackpad's horizontal scroll is continuous and
 * arrives as wheel events that the strip itself wants, so binding this to the
 * pointer would make a desktop reader change section while trying to nudge the
 * category row.
 *
 * The order arrives as a prop rather than from the taxonomy directly: that
 * module reaches node:sqlite through the category list, and importing it here
 * drags the whole store into the browser bundle.
 */
export function CategoryPager({
  active, sections, children,
}: { active: string; sections: PagerSection[]; children?: ReactNode }) {
  const navigate = useNavigate();
  // Typed per route rather than one computed path: 'top' is the index route,
  // every other slug is a param on /c/$cat.
  const go = (slug: string) =>
    slug === 'top'
      ? navigate({ to: '/', replace: true, resetScroll: false })
      : navigate({ to: '/c/$cat', params: { cat: slug }, replace: true, resetScroll: false });
  const track = useRef<HTMLDivElement>(null);

  // Which slug the window is built around. It runs ahead of `active` for the
  // length of a commit — that gap is the whole point.
  const [centre, setCentre] = useState(active);
  const [seen, setSeen] = useState(active);
  const [neighbours, setNeighbours] = useState(false);

  // A navigation from outside the gesture - the strip, a link, the back button -
  // has to move the window. Adjusted during the render that brings the new prop
  // in rather than in an effect afterwards: the effect painted one frame of the
  // outgoing category first. It cannot be derived away, because after a swipe
  // `centre` leads `active` for the length of the commit, which is the point.
  if (seen !== active) { setSeen(active); setCentre(active); }

  // Shown once ever, and never to a reader who already knows: the peek says
  // the sections continue sideways, and this says the page will follow a
  // finger. A demonstration rather than a sentence - there is nowhere on this
  // page to put a sentence, and it would need translating.
  useEffect(() => {
    if (!neighbours) return;                 // wait until there is a neighbour to show
    try { if (localStorage.getItem(NUDGED)) return; } catch { return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Touch only, for the same reason the gesture is: a pointer cannot do it.
    if (!window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

    const el = track.current;
    if (!el) return;
    const t = window.setTimeout(() => {
      el.style.transition = `transform 420ms ${EASE}`;
      el.style.transform = 'translate3d(calc(-33.3333% - 26px), 0, 0)';
      window.setTimeout(() => { el.style.transform = ''; }, 430);
      window.setTimeout(() => { el.style.transition = ''; }, 900);
      try { localStorage.setItem(NUDGED, '1'); } catch { /* it will nudge once more */ }
    }, 900);                                  // after the rows have settled
    return () => window.clearTimeout(t);
  }, [neighbours]);

  // Nothing off-screen competes with the first paint; after it, both sides are
  // mounted for good, because a neighbour that unmounts is a neighbour that has
  // to be fetched again the next time a finger goes looking for it.
  useEffect(() => {
    const idle = typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => setNeighbours(true))
      : setTimeout(() => setNeighbours(true), 300);
    return () => {
      if (typeof cancelIdleCallback === 'function' && typeof idle === 'number') cancelIdleCallback(idle);
      else clearTimeout(idle as ReturnType<typeof setTimeout>);
    };
  }, []);

  // The re-centre. The pane that was on the right is now the middle one, so the
  // track has to give back exactly the distance it just travelled, in the same
  // frame the reorder lands in and with no transition to interpolate it.
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    el.style.transition = 'none';
    el.style.transform = '';
    void el.offsetWidth;
    el.style.transition = '';
  }, [centre]);

  const key = sections.map((s) => s.slug).join('|');

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const slugs = key.split('|');
    const at = slugs.indexOf(centre);
    if (at < 0) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let x = 0, y = 0, t = 0;
    let mode: 'off' | 'watching' | 'dragging' = 'off';
    let width = 1;
    let busy = false;

    const paint = (dx: number) => {
      el.style.transform = dx
        ? `translate3d(calc(-33.3333% + ${dx}px), 0, 0)`
        : '';
    };

    const settle = () => {
      el.style.transition = `transform ${reduced ? 0 : SETTLE_MS}ms ${EASE}`;
      paint(0);
    };

    const start = (e: TouchEvent) => {
      // One finger only: two is a pinch, and a gesture that begins inside a
      // horizontal scroller belongs to that scroller.
      if (busy || e.touches.length !== 1) { mode = 'off'; return; }
      const target = e.target as Element | null;
      if (target?.closest?.('.catstrip, .substrip, .reel, [data-noswipe]')) { mode = 'off'; return; }
      const p = e.touches[0];
      x = p.clientX; y = p.clientY; t = Date.now();
      mode = 'watching';
      width = Math.max(1, el.clientWidth / 3);
    };

    const move = (e: TouchEvent) => {
      if (mode === 'off' || e.touches.length !== 1) return;
      const p = e.touches[0];
      const dx = p.clientX - x;
      const dy = p.clientY - y;

      if (mode === 'watching') {
        // Wait until the gesture has declared itself. Down the page wins ties,
        // so reading never fights the swipe.
        if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.2) { mode = 'off'; return; }
        mode = 'dragging';
        el.style.transition = '';
      }

      // Past the first or last category there is nowhere to go, so the pull is
      // damped instead of refused: the strip's end is something you can feel.
      const blocked = !slugs[at + (dx < 0 ? 1 : -1)];
      paint(blocked ? dx / RUBBER : dx);
      // Once we own the gesture the page must not also scroll under it.
      if (e.cancelable) e.preventDefault();
    };

    const end = (e: TouchEvent) => {
      if (mode !== 'dragging') { mode = 'off'; return; }
      mode = 'off';
      const p = e.changedTouches[0];
      if (!p) { settle(); return; }

      const dx = p.clientX - x;
      const step = dx < 0 ? 1 : -1;
      const to = slugs[at + step];
      const speed = Math.abs(dx) / Math.max(1, Date.now() - t);
      const commit = to && (Math.abs(dx) > width * COMMIT || speed > FLICK_PX_PER_MS);

      if (!commit) { settle(); return; }

      busy = true;
      el.style.transition = `transform ${reduced ? 0 : SETTLE_MS}ms ${EASE}`;
      paint(-step * width);

      // The URL follows the movement rather than causing it. `replace`, not
      // `push`: the swipe is a move along one strip, and a back button that had
      // to walk every category the reader passed through would be useless.
      window.setTimeout(() => {
        busy = false;
        setCentre(to);
        void go(to);
      }, reduced ? 0 : SETTLE_MS);
    };

    const cancel = () => { if (mode === 'dragging') settle(); mode = 'off'; };

    // Capture phase: a swipe has to be recognised before any card, scroller or
    // link in the tree gets a say, and touchmove must be non-passive or the
    // preventDefault that stops the page scrolling under the drag is ignored.
    const opts = { passive: false, capture: true } as const;
    window.addEventListener('touchstart', start, { passive: true, capture: true });
    window.addEventListener('touchmove', move, opts);
    window.addEventListener('touchend', end, { passive: true, capture: true });
    window.addEventListener('touchcancel', cancel, { passive: true, capture: true });
    return () => {
      window.removeEventListener('touchstart', start, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('touchend', end, true);
      window.removeEventListener('touchcancel', cancel, true);
    };
  }, [centre, key, navigate]);

  // Out of range reads as an absent neighbour on its own: the guards spelled
  // out what `?? null` already says, for a `centre` that is always a slug from
  // this list.
  const at = sections.findIndex((s) => s.slug === centre);
  const panes: (PagerSection | null)[] = [
    sections[at - 1] ?? null, sections[at] ?? null, sections[at + 1] ?? null,
  ];

  return (
    <div className="pager">
      <div className="pagerTrack" ref={track}>
        {panes.map((s, i) => (
          <div key={s ? s.slug : `edge-${i}`} className={i === 1 ? 'pagerPane' : 'pagerPane pagerPane--side'}>
            {/* Keyed by slug, so re-centring moves the pane rather than
                rebuilding it — a rebuilt pane would paint the outgoing
                section's rows once before its own arrived. */}
            {!s ? null
              : s.slug === active && children ? children
              : i === 1 || neighbours ? <SectionFeed cat={s.slug} name={s.name} />
              : null}
          </div>
        ))}
      </div>
    </div>
  );
}
