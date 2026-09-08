import Link from 'next/link';
import { Bookmark, Compass, Home, Near, Person } from './icons';
import { Logo } from './Logo';

type Tab = 'home' | 'local' | 'explore' | 'reels' | 'saved' | 'profile';

/**
 * Six destinations now, and the reels disc still has to sit on the centre line —
 * with six equal children and space-between it would drift left. The tabs are
 * grouped either side of the disc instead, each group taking half the free
 * width, which pins the disc to the middle whatever the counts are.
 */
export function TabBar({ active = 'home' }: { active?: Tab }) {
  const tab = (href: string, key: Tab, label: string, icon: React.ReactNode) => (
    <Link href={href} className="tab" data-active={active === key}
          aria-current={active === key ? 'page' : undefined}>{icon}<span>{label}</span></Link>
  );

  return (
    <nav className="tabbar" aria-label="Primary">
      <div className="inner">
        <div className="tabgroup">
          {tab('/', 'home', 'Home', <Home />)}
          {tab('/local', 'local', 'Local', <Near />)}
          {tab('/explore', 'explore', 'Explore', <Compass />)}
        </div>
        <Link href="/reels" className="reelsbtn" data-active={active === 'reels'} aria-current={active === 'reels' ? 'page' : undefined} aria-label="News reels"><Logo size={26} tone="invert" tight /><span className="reelsbtn__label">Reels</span></Link>
        <div className="tabgroup">
          {tab('/saved', 'saved', 'Saved', <Bookmark />)}
          {tab('/profile', 'profile', 'Profile', <Person />)}
        </div>
      </div>
    </nav>
  );
}
