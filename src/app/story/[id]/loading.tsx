import Link from 'next/link';
import { Back } from '@/components/icons';
import { TabBar } from '@/components/TabBar';

/**
 * The reason this route felt slow, and the reason it now does not.
 *
 * Without a boundary here a click waited on the whole server render with the
 * old page still on screen — and, less obviously, there was nothing for the
 * router to prefetch: App Router prefetches a dynamic route only as far as its
 * nearest loading state, and this one had none, so a warmed card fetched
 * exactly nothing.
 *
 * The cost is the status code. notFound() in the page can no longer set 404,
 * because the fallback starts the body — and therefore commits 200 — before
 * the page has looked the story up. A dead link still lands on the not-found
 * screen and still reads correctly; only a crawler can tell the difference,
 * and this is a PWA with no sitemap and a start_url of '/'. Paying that for an
 * instant paint on every story in the app is the trade this route wanted.
 */
export default function LoadingStory() {
  return (
    <>
      <main className="shell" aria-busy="true" aria-label="Loading story">
        <header className="story__topbar">
          <Link href="/" className="story__back" aria-label="Back"><Back /></Link>
        </header>

        <div className="detail">
          <div className="story__head">
            <div className="story__headtext">
              <div className="skel" style={{ height: 34, marginBottom: 10 }} />
              <div className="skel" style={{ height: 34, width: '72%' }} />
            </div>
            <div className="skel plate--detail" />
          </div>

          <div className="detail__main">
            <div className="skel" style={{ minHeight: 200 }} />
          </div>

          <div className="detail__side story__rail">
            <div className="skel" style={{ minHeight: 160 }} />
          </div>
        </div>
      </main>
      <TabBar active="home" />
    </>
  );
}
