/**
 * The smartnews mark: three stacked cards of increasing width, largest in
 * front — many articles collapsing into one. Same geometry as public/icon.svg.
 *
 * `tight` crops the viewBox to the bars themselves, for use inside a control
 * where the icon's own padding would fight the control's.
 */
export function Logo({
  size = 24, tone = 'brand', tight = false,
}: { size?: number; tone?: 'brand' | 'ink' | 'invert'; tight?: boolean }) {
  const fills = {
    brand:  ['oklch(0.80 0.050 252)', 'oklch(0.66 0.100 252)', 'var(--accent)'],
    ink:    ['oklch(0.72 0.020 258)', 'oklch(0.48 0.016 258)', 'var(--ink)'],
    invert: ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.70)', '#fff'],
  }[tone];

  const box = tight ? '5 11 54 44' : '0 0 64 64';
  const height = tight ? Math.round((size * 44) / 54) : size;

  return (
    <svg width={size} height={height} viewBox={box} fill="none" aria-hidden focusable="false">
      <rect x="17" y="11" width="30" height="8"  rx="4" fill={fills[0]} />
      <rect x="11" y="23" width="42" height="10" rx="5" fill={fills[1]} />
      <rect x="5"  y="35" width="54" height="20" rx="8" fill={fills[2]} />
    </svg>
  );
}
