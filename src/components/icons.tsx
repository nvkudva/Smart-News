type P = { size?: number; className?: string };
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.9,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const Home = ({ size = 21 }: P) => (
  <svg {...base(size)}><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" /></svg>
);
export const Compass = ({ size = 21 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="m15.2 8.8-2 4.4-4.4 2 2-4.4Z" /></svg>
);
export const Bookmark = ({ size = 21 }: P) => (
  <svg {...base(size)}><path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" /></svg>
);
export const Person = ({ size = 21 }: P) => (
  <svg {...base(size)}><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></svg>
);
/* Tab-weight sibling of Pin: same landmark, drawn at the 1.9 stroke the other
   tab glyphs use so the bar reads as one set. */
export const Near = ({ size = 21 }: P) => (
  <svg {...base(size)}><path d="M19 10.5c0 5.4-7 11-7 11s-7-5.6-7-11a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10.3" r="2.6" /></svg>
);
export const Reels = ({ size = 24 }: P) => (
  <svg {...base(size)}><rect x="6" y="9.5" width="12" height="11" rx="3" /><path d="M8.5 6.5h7" /><path d="m9.6 4 2.4-2 2.4 2" /></svg>
);
export const Pin = ({ size = 11 }: P) => (
  <svg {...base(size)} strokeWidth={2.4}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
);
export const Back = ({ size = 21 }: P) => (
  <svg {...base(size)} strokeWidth={2.2}><path d="m14.5 5-7 7 7 7" /></svg>
);
export const Photo = ({ size = 26 }: P) => (
  <svg {...base(size)} strokeWidth={1.6}><rect x="3" y="5" width="18" height="14" rx="2.5" /><circle cx="8.5" cy="10" r="1.6" /><path d="m3.5 16.5 4.5-4 3.5 3 3.5-3.5 5.5 5" /></svg>
);
