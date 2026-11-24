import { Link } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import {
  getPodcastSnapshot,
  nextCategory,
  nextStory,
  prevStory,
  stopPodcast,
  subscribePodcast,
  togglePlayPause,
} from '../lib/podcastStore';
import { FastForward, Pause, Play, SkipNext, SkipPrev, Stop } from './icons';

const RING_R = 24;
const RING_C = 2 * Math.PI * RING_R;

export function PodcastToggleButton({
  className,
  showLabel = false,
  iconSize = 20,
}: {
  className: string;
  showLabel?: boolean;
  iconSize?: number;
}) {
  const { status, progress, preloadProgress, preloadReady } = useSyncExternalStore(
    subscribePodcast,
    getPodcastSnapshot,
    getPodcastSnapshot,
  );

  const label =
    status === 'playing' ? 'Pause news podcast'
      : status === 'paused' ? 'Resume news podcast'
        : status === 'loading' ? 'Loading news podcast'
          : preloadReady ? 'Play live news podcast (ready)'
            : 'Play live news podcast';

  const shortText =
    status === 'playing' ? 'Pause'
      : status === 'paused' ? 'Resume'
        : status === 'loading' ? (progress !== null ? `Loading ${progress}%` : 'Preparing…')
          : 'Listen';

  const activeProgress = status === 'loading' ? progress : status === 'idle' ? preloadProgress : null;
  const showRing = status === 'loading' || (status === 'idle' && preloadProgress !== null);
  const ringOffset = activeProgress !== null
    ? RING_C * (1 - Math.max(0, Math.min(100, activeProgress)) / 100)
    : RING_C * 0.72;

  return (
    <button
      type="button"
      className={className}
      data-status={status}
      onClick={() => void togglePlayPause()}
      aria-label={label}
      title={label}
    >
      {showRing && (
        <svg
          className={`podcast__ring${status === 'loading' && progress === null ? ' podcast__ring--spin' : ''}${status === 'idle' ? ' podcast__ring--preloading' : ''}`}
          viewBox="0 0 54 54"
          aria-hidden
        >
          <circle cx="27" cy="27" r={RING_R} className="podcast__ring-track" />
          <circle
            cx="27"
            cy="27"
            r={RING_R}
            className="podcast__ring-fill"
            strokeDasharray={RING_C}
            strokeDashoffset={ringOffset}
          />
        </svg>
      )}
      {status === 'playing' ? <Pause size={iconSize} /> : <Play size={iconSize} />}
      {showLabel && <span className="podcastdisc__label">{shortText}</span>}
    </button>
  );
}

export function PodcastPlayer() {
  const state = useSyncExternalStore(subscribePodcast, getPodcastSnapshot, getPodcastSnapshot);
  const { status, engine, progress, tracks, index, error } = state;
  const active = status !== 'idle';
  const track = tracks[index];
  const hasMultipleCategories = new Set(tracks.map((t) => t.categoryKey)).size > 1;

  return (
    <div className="podcast" data-status={status}>
      {active && (
        <div className="podcast__tray" role="region" aria-label="Podcast controls">
          <div className="podcast__meta">
            {error ? (
              <span className="podcast__kicker podcast__kicker--err">{error}</span>
            ) : status === 'loading' && progress !== null ? (
              <>
                <span className="podcast__kicker">Downloading Kokoro voice · {progress}%</span>
                <span className="podcast__title">
                  {track ? track.headline : 'Preparing top stories…'}
                </span>
              </>
            ) : status === 'loading' && track ? (
              <>
                <span className="podcast__kicker">Preparing voice · {track.category}</span>
                <span className="podcast__title">{track.headline}</span>
              </>
            ) : track ? (
              <>
                <span className="podcast__kicker">
                  {track.category} · {track.indexInCategory}/{track.totalInCategory}
                  {engine === 'speech' ? ' · Browser voice' : ''}
                </span>
                <Link to="/story/$id" params={{ id: track.id }} className="podcast__title" preload={false}>
                  {track.headline}
                </Link>
              </>
            ) : (
              <span className="podcast__kicker">Preparing live podcast…</span>
            )}
          </div>

          <div className="podcast__actions">
            <button
              type="button"
              className="podcast__btn"
              onClick={prevStory}
              disabled={tracks.length === 0 || index === 0}
              aria-label="Previous story"
              title="Previous story"
            >
              <SkipPrev size={16} />
            </button>
            <button
              type="button"
              className="podcast__btn"
              onClick={nextStory}
              disabled={tracks.length === 0}
              aria-label="Next story"
              title="Next story"
            >
              <SkipNext size={16} />
            </button>
            <button
              type="button"
              className="podcast__btn"
              onClick={nextCategory}
              disabled={!hasMultipleCategories}
              aria-label="Next category"
              title="Next category"
            >
              <FastForward size={16} />
            </button>
            <button
              type="button"
              className="podcast__btn podcast__btn--stop"
              onClick={stopPodcast}
              aria-label="Stop podcast"
              title="Stop"
            >
              <Stop size={14} />
            </button>
          </div>
        </div>
      )}

      <PodcastToggleButton className="podcast__fab" />
    </div>
  );
}
