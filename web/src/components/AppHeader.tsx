import { Link } from '@tanstack/react-router';
import { HeaderAside } from './HeaderAside';
import { Logo } from './Logo';
import { Bookmark, Compass, Home, Person } from './icons';

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
        <Link to="/" className="appbar__brand" aria-label="smartnews home">
          <Logo size={31} tone="ink" />
          <span>smartnews</span>
        </Link>
        <HeaderNav />
        <HeaderAside />
      </div>
    </header>
  );
}

/**
 * The same five destinations as the dock, in the header. Shown on a wide screen
 * by default and wherever the reader picks "Header bar"; the dock hides in step
 * (see the data-nav block in globals.css). Each Link marks itself current, so
 * the header needs no active prop from the route the way TabBar does.
 */
function HeaderNav() {
  const item = (to: string, label: string, icon: React.ReactNode, exact = false, extra = '') => (
    <Link to={to} className={`appnav__link ${extra}`.trimEnd()} activeOptions={{ exact }}
          activeProps={{ 'aria-current': 'page' }}>{icon}<span>{label}</span></Link>
  );
  return (
    <nav className="appnav" aria-label="Primary">
      {item('/', 'Home', <Home />, true)}
      {item('/explore', 'Explore', <Compass />)}
      {item('/reels', 'Reels', <Logo size={18} tone="ink" tight />, false, 'appnav__link--reels')}
      {item('/saved', 'Saved', <Bookmark />)}
      {item('/profile', 'Profile', <Person />)}
    </nav>
  );
}
