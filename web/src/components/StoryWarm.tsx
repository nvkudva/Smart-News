
import { useEffect } from 'react';
import { useRouter } from '@tanstack/react-router';

/** Long enough that a pointer crossing a grid on its way somewhere else does
 *  not warm every card it passes over; short enough to be finished before a
 *  reader who meant it has clicked. */
const DWELL_MS = 120;

/** A sweep across a long feed is not thirty intentions. */
const MAX_WARM = 40;

/**
 * What StripScroller does for the strip, for story cards.
 *
 * A card's link goes to a force-dynamic route, so a click waits on the whole
 * server render and nothing paints until it lands — the strip feels instant
 * only because its destination was already fetched before the tap. Cards had
 * no such thing: plain links, no prefetch, nothing warmed.
 *
 * Delegated from the document rather than added per card. There are thirty of
 * them on a feed, six more under a story and twenty in the reels stack, all
 * rendered by different components, and one listener outlives every one of
 * them.
 */
export function StoryWarm() {
  const router = useRouter();

  useEffect(() => {
    const warmed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const hrefFrom = (e: Event) => {
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      const href = link?.getAttribute('href');
      return href?.startsWith('/story/') ? href : null;
    };

    const go = (href: string) => {
      if (warmed.has(href) || warmed.size >= MAX_WARM) return;
      warmed.add(href);
      // preloadRoute runs the route's loader, so this warms the story payload
      // itself and not merely its chunk - which is what router.prefetch could
      // only do once the server render existed to be fetched.
      const id = decodeURIComponent(href.slice('/story/'.length));
      void router.preloadRoute({ to: '/story/$id', params: { id } }).catch(() => {});
    };

    // A pointer has to settle; a finger landing on a card is already intent.
    const over = (e: Event) => {
      const href = hrefFrom(e);
      clearTimeout(timer);
      if (href) timer = setTimeout(() => go(href), DWELL_MS);
    };
    const touch = (e: Event) => { const href = hrefFrom(e); if (href) go(href); };

    const opts = { passive: true, capture: true } as const;
    document.addEventListener('pointerover', over, opts);
    document.addEventListener('touchstart', touch, opts);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('touchstart', touch, true);
    };
  }, [router]);

  return null;
}
