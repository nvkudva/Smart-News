import type { ProfilePayload } from '../../shared/types';
import { HIDDEN_KEY, INTERESTS_KEY } from './boot';
import { fetchJson } from './load';
import {
  buildPodcastQueue,
  nextCategoryIndex,
  speakableText,
  type PodcastTrack,
} from './podcastQueue';
import {
  initKokoro,
  isKokoroReady,
  markKokoroFailed,
  onModelProgress,
  pauseAudio,
  playNativeSpeech,
  preferNativeSpeech,
  resumeAudio,
  startPcmStream,
  stopActiveAudio,
  synthesizeKokoro,
  unlockAudio,
  type EngineKind,
} from './ttsEngine';
import { heldWorld, loadWorld, onWorldUpdate } from './world';

export type PodcastStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

export type PodcastState = {
  status: PodcastStatus;
  engine: EngineKind | null;
  progress: number | null;
  preloadProgress: number | null;
  preloadReady: boolean;
  tracks: PodcastTrack[];
  index: number;
  error: string | null;
};

let state: PodcastState = {
  status: 'idle',
  engine: null,
  progress: null,
  preloadProgress: null,
  preloadReady: false,
  tracks: [],
  index: 0,
  error: null,
};

let playSeq = 0;
let cancelActiveSynthesis: (() => void) | null = null;
let cachedPrefs: { interests: string[]; hidden: string[] } | null = null;
let preloadStarted = false;
let warmingFirstTrack = false;
const watchers = new Set<() => void>();

function emit(patch: Partial<PodcastState>) {
  state = { ...state, ...patch };
  syncMediaSession();
  watchers.forEach((fn) => fn());
}

export function subscribePodcast(fn: () => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

export function getPodcastSnapshot(): PodcastState {
  return state;
}

function readLocalPrefs(): { interests: string[]; hidden: string[] } {
  let interests: string[] = [];
  let hidden: string[] = [];
  try {
    const rawInterests = localStorage.getItem(INTERESTS_KEY);
    if (rawInterests) {
      const parsed = JSON.parse(rawInterests);
      if (Array.isArray(parsed)) interests = parsed.filter((x): x is string => typeof x === 'string');
    }
    const rawHidden = localStorage.getItem(HIDDEN_KEY) ?? document.documentElement.dataset.hidden ?? '';
    if (rawHidden) {
      hidden = rawHidden.split(',').map((s) => s.trim()).filter(Boolean);
    }
  } catch { /* ignore storage errors */ }
  return { interests, hidden };
}

async function resolvePrefs(): Promise<{ interests: string[]; hidden: string[] }> {
  const local = readLocalPrefs();
  if (cachedPrefs) {
    // Re-read hidden/interests from localStorage in case user toggled settings since last fetch
    return {
      interests: local.interests.length ? local.interests : cachedPrefs.interests,
      hidden: local.hidden.length ? local.hidden : cachedPrefs.hidden,
    };
  }
  try {
    const profile = await fetchJson<ProfilePayload>('/api/profile');
    cachedPrefs = {
      interests: [...profile.prefs.categories],
      hidden: [...profile.prefs.hidden],
    };
    try {
      localStorage.setItem(INTERESTS_KEY, JSON.stringify(cachedPrefs.interests));
    } catch { /* ignore */ }
    return cachedPrefs;
  } catch {
    return local;
  }
}

async function warmFirstTrack() {
  if (warmingFirstTrack || state.preloadReady || state.status !== 'idle' || preferNativeSpeech() || !isKokoroReady()) {
    return;
  }
  const world = await heldWorld();
  if (!world || state.status !== 'idle' || state.preloadReady) return;
  const prefs = readLocalPrefs();
  const tracks = buildPodcastQueue(world, prefs.interests, prefs.hidden);
  if (tracks.length === 0) return;

  const first = tracks[0];
  const text = speakableText(first, true);
  const key = `${first.id}:intro`;
  warmingFirstTrack = true;
  try {
    await synthesizeKokoro(key, text).promise;
    emit({ preloadReady: true });
  } catch {
    // Passive preload failures must not disable Kokoro when user clicks Play later.
  } finally {
    warmingFirstTrack = false;
  }
}

onModelProgress((percent) => {
  if (percent === null) {
    emit({
      preloadProgress: null,
      progress: state.status === 'loading' ? null : state.progress,
    });
    if (preloadStarted) void warmFirstTrack();
    return;
  }
  emit({
    preloadProgress: percent,
    progress: state.status === 'loading' ? percent : state.progress,
  });
});

export function preloadPodcast(): () => void {
  if (preferNativeSpeech()) return () => {};
  preloadStarted = true;
  let cancelled = false;
  let stopWorldWatch: (() => void) | null = null;

  const timer = setTimeout(() => {
    if (cancelled || state.status !== 'idle') return;
    initKokoro();
    if (isKokoroReady()) {
      void warmFirstTrack();
    } else {
      stopWorldWatch = onWorldUpdate(() => {
        if (!cancelled && isKokoroReady()) void warmFirstTrack();
      });
    }
  }, 800);

  return () => {
    cancelled = true;
    clearTimeout(timer);
    stopWorldWatch?.();
  };
}

function prefetchNext(tracks: PodcastTrack[], currentIndex: number) {
  if (preferNativeSpeech()) return;
  const nextIdx = currentIndex + 1;
  if (nextIdx >= tracks.length) return;
  const next = tracks[nextIdx];
  const text = speakableText(next, next.indexInCategory === 1);
  const key = `${next.id}:${next.indexInCategory === 1 ? 'intro' : 'body'}`;
  void synthesizeKokoro(key, text).promise.catch(() => {});
}

async function playTrackAt(targetIndex: number, includeIntro: boolean) {
  const { tracks } = state;
  if (targetIndex < 0 || targetIndex >= tracks.length) {
    stopPodcast();
    return;
  }

  const seq = ++playSeq;
  const track = tracks[targetIndex];
  const text = speakableText(track, includeIntro);
  const useSpeech = preferNativeSpeech();

  cancelActiveSynthesis?.();
  cancelActiveSynthesis = null;
  stopActiveAudio();
  emit({
    index: targetIndex,
    status: useSpeech ? 'playing' : 'loading',
    engine: useSpeech ? 'speech' : 'kokoro',
    progress: useSpeech || isKokoroReady() ? null : (state.preloadProgress ?? state.progress ?? 0),
    error: null,
  });

  const advance = () => {
    if (seq !== playSeq) return;
    if (targetIndex + 1 < state.tracks.length) {
      const next = state.tracks[targetIndex + 1];
      void playTrackAt(targetIndex + 1, next.indexInCategory === 1);
    } else {
      stopPodcast();
    }
  };

  if (useSpeech) {
    playNativeSpeech(text, advance, (err) => {
      if (seq !== playSeq) return;
      emit({ status: 'error', error: err.message });
    });
    return;
  }

  const key = `${track.id}:${includeIntro ? 'intro' : 'body'}`;
  const playback = startPcmStream(
    () => {
      if (seq !== playSeq) return;
      emit({ status: 'playing', engine: 'kokoro', progress: null });
    },
    advance,
  );
  let chunkChain = Promise.resolve();
  const job = synthesizeKokoro(key, text, (chunk) => {
    if (seq !== playSeq) return;
    chunkChain = chunkChain.then(() => playback.pushChunk(chunk));
  });
  cancelActiveSynthesis = job.cancel;

  try {
    await job.promise;
    if (seq !== playSeq) return;
    cancelActiveSynthesis = null;
    await chunkChain;
    if (seq !== playSeq) return;
    playback.finish();
    prefetchNext(state.tracks, targetIndex);
  } catch {
    if (seq !== playSeq) return;
    cancelActiveSynthesis = null;
    // Graceful fallback if ONNX download or WASM fails (e.g. offline without cached weights)
    markKokoroFailed();
    emit({ status: 'playing', engine: 'speech', progress: null, error: null });
    playNativeSpeech(text, advance, (err) => {
      if (seq !== playSeq) return;
      emit({ status: 'error', error: err.message });
    });
  }
}

async function startPodcast() {
  const seq = ++playSeq;
  unlockAudio();
  emit({
    status: 'loading',
    progress: preferNativeSpeech() || isKokoroReady() ? null : (state.preloadProgress ?? 0),
    error: null,
  });

  try {
    const [world, prefs] = await Promise.all([
      heldWorld().then((w) => w ?? loadWorld()),
      resolvePrefs(),
    ]);
    if (seq !== playSeq) return;

    const tracks = buildPodcastQueue(world, prefs.interests, prefs.hidden);
    if (tracks.length === 0) {
      emit({ status: 'error', progress: null, error: 'No stories ready to play.' });
      return;
    }
    emit({ tracks, index: 0 });
    await playTrackAt(0, true);
  } catch (err) {
    if (seq !== playSeq) return;
    emit({
      status: 'error',
      progress: null,
      error: err instanceof Error ? err.message : 'Could not load stories.',
    });
  }
}

export async function togglePlayPause(): Promise<void> {
  if (state.status === 'idle' || state.status === 'error') {
    await startPodcast();
    return;
  }
  if (state.status === 'playing') {
    await pauseAudio(state.engine);
    emit({ status: 'paused' });
    return;
  }
  if (state.status === 'paused') {
    await resumeAudio(state.engine);
    emit({ status: 'playing' });
  }
}

export function stopPodcast(): void {
  playSeq++;
  cancelActiveSynthesis?.();
  cancelActiveSynthesis = null;
  stopActiveAudio();
  emit({
    status: 'idle',
    progress: null,
    index: 0,
    error: null,
  });
}

export function nextStory(): void {
  if (state.tracks.length === 0) return;
  const next = state.index + 1;
  if (next >= state.tracks.length) {
    stopPodcast();
    return;
  }
  void playTrackAt(next, state.tracks[next].indexInCategory === 1);
}

export function prevStory(): void {
  if (state.tracks.length === 0) return;
  const prev = Math.max(0, state.index - 1);
  void playTrackAt(prev, state.tracks[prev].indexInCategory === 1);
}

export function nextCategory(): void {
  const next = nextCategoryIndex(state.tracks, state.index);
  if (next < 0) return;
  void playTrackAt(next, true);
}

function syncMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  if (state.status === 'idle') {
    ms.playbackState = 'none';
    ms.metadata = null;
    return;
  }
  const track = state.tracks[state.index];
  if (track && typeof MediaMetadata !== 'undefined') {
    ms.metadata = new MediaMetadata({
      title: track.headline,
      artist: `${track.category} (${track.indexInCategory}/${track.totalInCategory})`,
      album: 'smartnews Live Podcast',
    });
  }
  ms.playbackState = state.status === 'playing' ? 'playing' : 'paused';
  try {
    ms.setActionHandler('play', () => { void togglePlayPause(); });
    ms.setActionHandler('pause', () => { void togglePlayPause(); });
    ms.setActionHandler('stop', () => { stopPodcast(); });
    ms.setActionHandler('nexttrack', () => { nextStory(); });
    ms.setActionHandler('previoustrack', () => { prevStory(); });
  } catch { /* unsupported action in some browsers */ }
}
