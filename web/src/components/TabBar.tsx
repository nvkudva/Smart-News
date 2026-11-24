import { Link } from '@tanstack/react-router';
import { Compass, Home, Person, Reels } from './icons';
import { PodcastToggleButton } from './PodcastPlayer';

export type Tab = 'home' | 'local' | 'explore' | 'reels' | 'saved' | 'profile';
// 'local' stays in the union: /local still exists and marks itself active,
// it simply no longer has its own tab now that Local is a category.

/**
 * The play disc sits on the centre line, and with plain space-between it drifts
 * as soon as the two sides hold different counts. The tabs are grouped either
 * side of the disc instead, each group taking half the free width, which pins
 * the disc to the middle whatever the counts are.
 */
export function TabBar({ active = 'home' }: { active?: Tab }) {
  const tab = (href: string, key: Tab, label: string, icon: React.ReactNode) => (
    <Link to={href} className="tab" data-active={active === key}
          aria-current={active === key ? 'page' : undefined}>{icon}<span>{label}</span></Link>
  );

  return (
    <nav className="tabbar" aria-label="Primary">
      <div className="inner">
        <div className="tabgroup">
          {tab('/', 'home', 'Home', <Home />)}
          {tab('/explore', 'explore', 'Explore', <Compass />)}
        </div>
        <PodcastToggleButton className="podcastdisc" showLabel />
        <div className="tabgroup">
          {tab('/reels', 'reels', 'Reels', <Reels size={21} />)}
          {tab('/profile', 'profile', 'Settings', <Person />)}
        </div>
      </div>
    </nav>
  );
}
