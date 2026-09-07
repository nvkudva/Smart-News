import Link from 'next/link';
import { Bookmark, Compass, Home, Person } from './icons';
import { Logo } from './Logo';

export function TabBar({ active = 'home' }: { active?: 'home' | 'explore' | 'reels' | 'saved' | 'profile' }) {
  return (
    <nav className="tabbar" aria-label="Primary">
      <div className="inner">
        <div className="railhead"><Logo size={22} tone="ink" />smartnews</div>
        <Link href="/" className="tab" data-active={active === 'home'} aria-current={active === 'home' ? 'page' : undefined}><Home /><span>Home</span></Link>
        <Link href="/explore" className="tab" data-active={active === 'explore'} aria-current={active === 'explore' ? 'page' : undefined}><Compass /><span>Explore</span></Link>
        <Link href="/reels" className="reelsbtn" data-active={active === 'reels'} aria-current={active === 'reels' ? 'page' : undefined} aria-label="News reels"><Logo size={26} tone="invert" tight /><span className="reelsbtn__label">Reels</span></Link>
        <Link href="/saved" className="tab" data-active={active === 'saved'} aria-current={active === 'saved' ? 'page' : undefined}><Bookmark /><span>Saved</span></Link>
        <Link href="/profile" className="tab" data-active={active === 'profile'} aria-current={active === 'profile' ? 'page' : undefined}><Person /><span>Profile</span></Link>
      </div>
    </nav>
  );
}
