import Link from 'next/link';
import { Bookmark, Compass, Home, Person, Reels } from './icons';

export function TabBar({ active = 'home' }: { active?: 'home' | 'explore' | 'saved' | 'profile' }) {
  return (
    <nav className="tabbar">
      <div className="inner">
        <Link href="/" className="tab" data-active={active === 'home'}><Home /><span>Home</span></Link>
        <Link href="/explore" className="tab" data-active={active === 'explore'}><Compass /><span>Explore</span></Link>
        <Link href="/reels" className="reelsbtn" aria-label="News reels"><Reels /></Link>
        <Link href="/saved" className="tab" data-active={active === 'saved'}><Bookmark /><span>Saved</span></Link>
        <Link href="/profile" className="tab" data-active={active === 'profile'}><Person /><span>Profile</span></Link>
      </div>
    </nav>
  );
}
