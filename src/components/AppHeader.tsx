import Link from 'next/link';
import { Logo } from './Logo';

/**
 * The wordmark used to live in the desktop rail. With the rail gone and the bar
 * at the bottom at every width, the top of the page is the only place branding
 * can sit without competing with the category strip.
 */
export function AppHeader() {
  return (
    <header className="appbar">
      <Link href="/" className="appbar__brand" aria-label="smartnews home">
        <Logo size={22} tone="ink" />
        <span>smartnews</span>
      </Link>
    </header>
  );
}
