import Link from 'next/link';
import { HeaderAside } from './HeaderAside';
import { Logo } from './Logo';

/**
 * The wordmark used to live in the desktop rail. With the rail gone and the bar
 * at the bottom at every width, the top of the page is the only place branding
 * can sit without competing with the category strip.
 *
 * Nothing here awaits anything: this component is in the root layout, so a
 * query in it would have made every page in the app render per request.
 */
export function AppHeader() {
  return (
    <header className="appbar">
      {/* The bar bleeds to the window edge; its contents do not. The inner
          column is the same --content the shell and the dock use, so the
          wordmark sits above the first card rather than out at the corner. */}
      <div className="appbar__inner">
        <Link href="/" className="appbar__brand" aria-label="smartnews home">
          <Logo size={31} tone="ink" />
          <span>smartnews</span>
        </Link>
        <HeaderAside />
      </div>
    </header>
  );
}
