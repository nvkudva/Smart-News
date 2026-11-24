export type EngineKind = 'kokoro' | 'speech';

export type PcmAudio = {
  pcm: Float32Array;
  sampleRate: number;
};

type StreamEntry = {
  key: string;
  sampleRate: number;
  chunks: Float32Array[];
  onChunk?: (audio: PcmAudio) => void;
  resolve: (audio: PcmAudio) => void;
  reject: (err: Error) => void;
};

const MAX_CACHE = 8;
const CHUNK_GAP_SEC = 0.16;
const pcmCache = new Map<string, PcmAudio>();

let worker: Worker | null = null;
let initStarted = false;
let workerReady = false;
let workerFailed = false;
let nextReqId = 1;

const inflight = new Map<number, StreamEntry>();
const pendingByKey = new Map<string, Promise<PcmAudio>>();
const inflightIdByKey = new Map<string, number>();
const progressListeners = new Set<(percent: number | null) => void>();

let audioCtx: AudioContext | null = null;
let graphCtx: AudioContext | null = null;
let eqInput: AudioNode | null = null;

const activeSources = new Set<AudioBufferSourceNode>();
let nextStartTime = 0;
let playbackToken = 0;
let speechToken = 0;
let isPaused = false;

/**
 * iOS/iPadOS Safari enforces a ~250-384 MB WebKit tab memory cap that kills
 * pages loading Kokoro-82M weights, so we route those devices to Web Speech.
 */
export function isIosWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /^((?!chrome|chromium|android|edg).)*safari/i.test(navigator.userAgent);
}

export function preferNativeSpeech(): boolean {
  return isIosWebKit() || workerFailed || typeof Worker === 'undefined';
}

export function onModelProgress(listener: (percent: number | null) => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

function ensureAudioGraph(ctx: AudioContext): AudioNode {
  if (graphCtx === ctx && eqInput) return eqInput;
  graphCtx = ctx;

  // Broadcast voice chain: rumble filter -> low warmth -> boxiness dip -> harshness tame -> air roll-off -> gentle leveling
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 75;
  highpass.Q.value = 0.7;

  const warmth = ctx.createBiquadFilter();
  warmth.type = 'lowshelf';
  warmth.frequency.value = 170;
  warmth.gain.value = 4.0;

  const mudCut = ctx.createBiquadFilter();
  mudCut.type = 'peaking';
  mudCut.frequency.value = 420;
  mudCut.Q.value = 1.2;
  mudCut.gain.value = -2.0;

  const harshCut = ctx.createBiquadFilter();
  harshCut.type = 'peaking';
  harshCut.frequency.value = 3400;
  harshCut.Q.value = 1.4;
  harshCut.gain.value = -2.0;

  const airRoll = ctx.createBiquadFilter();
  airRoll.type = 'highshelf';
  airRoll.frequency.value = 7500;
  airRoll.gain.value = -3.0;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.008;
  comp.release.value = 0.18;

  const makeup = ctx.createGain();
  makeup.gain.value = 1.15;

  highpass.connect(warmth);
  warmth.connect(mudCut);
  mudCut.connect(harshCut);
  harshCut.connect(airRoll);
  airRoll.connect(comp);
  comp.connect(makeup);
  makeup.connect(ctx.destination);

  eqInput = highpass;
  return highpass;
}

export function initKokoro(): void {
  if (preferNativeSpeech() || initStarted || workerReady) return;
  initStarted = true;
  getWorker().postMessage({ type: 'init' });
}

export function isKokoroReady(): boolean {
  return workerReady;
}

export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (Ctx) {
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
  }
  // iOS/macOS Safari drop async speechSynthesis.speak() unless primed synchronously inside the tap gesture.
  if ((preferNativeSpeech() || isSafari()) && 'speechSynthesis' in window) {
    try {
      const prime = new SpeechSynthesisUtterance('');
      prime.volume = 0;
      window.speechSynthesis.speak(prime);
    } catch { /* ignore */ }
  }
}

function concatChunks(chunks: Float32Array[], sampleRate: number): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  if (chunks.length === 1) return chunks[0];
  const gap = Math.floor(sampleRate * CHUNK_GAP_SEC);
  let total = 0;
  for (let i = 0; i < chunks.length; i++) {
    total += chunks[i].length + (i < chunks.length - 1 ? gap : 0);
  }
  const merged = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset);
    offset += chunks[i].length + (i < chunks.length - 1 ? gap : 0);
  }
  return merged;
}

function setCached(key: string, audio: PcmAudio) {
  if (pcmCache.has(key)) pcmCache.delete(key);
  pcmCache.set(key, audio);
  if (pcmCache.size > MAX_CACHE) {
    const oldest = pcmCache.keys().next().value;
    if (oldest !== undefined) pcmCache.delete(oldest);
  }
}

function failAllInflight(message: string) {
  for (const [id, entry] of inflight.entries()) {
    inflight.delete(id);
    pendingByKey.delete(entry.key);
    inflightIdByKey.delete(entry.key);
    entry.reject(new Error(message));
  }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./ttsWorker.ts', import.meta.url), { type: 'module' });
  worker.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data as
      | { type: 'progress'; percent: number }
      | { type: 'ready' }
      | { type: 'chunk'; id: number; pcm: ArrayBuffer; sampleRate: number }
      | { type: 'done'; id: number }
      | { type: 'error'; id?: number; message: string };

    if (msg.type === 'progress') {
      progressListeners.forEach((fn) => fn(msg.percent));
      return;
    }
    if (msg.type === 'ready') {
      workerReady = true;
      progressListeners.forEach((fn) => fn(null));
      return;
    }
    if (msg.type === 'chunk' && typeof msg.id === 'number') {
      const entry = inflight.get(msg.id);
      if (!entry) return;
      const chunk = new Float32Array(msg.pcm);
      entry.sampleRate = msg.sampleRate;
      entry.chunks.push(chunk);
      entry.onChunk?.({ pcm: chunk, sampleRate: msg.sampleRate });
      return;
    }
    if (msg.type === 'done' && typeof msg.id === 'number') {
      const entry = inflight.get(msg.id);
      if (!entry) return;
      inflight.delete(msg.id);
      inflightIdByKey.delete(entry.key);
      const audio: PcmAudio = {
        pcm: concatChunks(entry.chunks, entry.sampleRate),
        sampleRate: entry.sampleRate,
      };
      setCached(entry.key, audio);
      entry.resolve(audio);
      return;
    }
    if (msg.type === 'error') {
      if (typeof msg.id === 'number') {
        const entry = inflight.get(msg.id);
        if (entry) {
          inflight.delete(msg.id);
          inflightIdByKey.delete(entry.key);
          entry.reject(new Error(msg.message));
        }
      } else {
        initStarted = false;
        failAllInflight(msg.message);
      }
    }
  });
  worker.addEventListener('error', (err) => {
    workerFailed = true;
    initStarted = false;
    failAllInflight(err.message || 'TTS worker error');
  });
  return worker;
}

function cancelJob(id: number) {
  const entry = inflight.get(id);
  if (!entry) return;
  entry.onChunk = undefined;
  inflight.delete(id);
  inflightIdByKey.delete(entry.key);
  pendingByKey.delete(entry.key);
  entry.reject(new Error('Cancelled'));
  worker?.postMessage({ type: 'cancel', id });
}

export function synthesizeKokoro(
  key: string,
  text: string,
  onChunk?: (audio: PcmAudio) => void,
  voice = 'af_heart',
  speed = 1,
): { promise: Promise<PcmAudio>; cancel: () => void } {
  const cached = pcmCache.get(key);
  if (cached) {
    pcmCache.delete(key);
    pcmCache.set(key, cached);
    onChunk?.(cached);
    return { promise: Promise.resolve(cached), cancel: () => {} };
  }

  const existing = pendingByKey.get(key);
  const existingId = inflightIdByKey.get(key);
  const existingEntry = existingId !== undefined ? inflight.get(existingId) : undefined;
  if (existing && existingEntry && existingId !== undefined) {
    if (onChunk) {
      for (const chunk of existingEntry.chunks) {
        onChunk({ pcm: chunk, sampleRate: existingEntry.sampleRate });
      }
      const prev = existingEntry.onChunk;
      existingEntry.onChunk = (audio) => {
        prev?.(audio);
        onChunk(audio);
      };
    }
    return { promise: existing, cancel: () => cancelJob(existingId) };
  }

  const w = getWorker();
  const id = nextReqId++;
  initStarted = true;

  const p = new Promise<PcmAudio>((resolve, reject) => {
    inflight.set(id, {
      key,
      sampleRate: 24_000,
      chunks: [],
      onChunk,
      resolve,
      reject,
    });
    inflightIdByKey.set(key, id);
    w.postMessage({ type: 'synthesize', id, text, voice, speed });
  }).finally(() => {
    if (pendingByKey.get(key) === p) pendingByKey.delete(key);
    if (inflightIdByKey.get(key) === id) inflightIdByKey.delete(key);
  });

  pendingByKey.set(key, p);

  return { promise: p, cancel: () => cancelJob(id) };
}

export function stopActiveAudio(): void {
  playbackToken++;
  speechToken++;
  isPaused = false;
  for (const src of activeSources) {
    try {
      src.onended = null;
      src.stop();
      src.disconnect();
    } catch { /* already stopped */ }
  }
  activeSources.clear();
  nextStartTime = 0;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

export type StreamPlayback = {
  pushChunk: (audio: PcmAudio) => Promise<void>;
  finish: () => void;
};

export function startPcmStream(onFirstAudio: () => void, onEnded: () => void): StreamPlayback {
  stopActiveAudio();
  const token = ++playbackToken;
  let streamDone = false;
  let firstFired = false;

  const maybeFinish = () => {
    if (token !== playbackToken) return;
    if (streamDone && activeSources.size === 0) {
      onEnded();
    }
  };

  const pushChunk = async (audio: PcmAudio) => {
    if (token !== playbackToken || audio.pcm.length === 0) return;
    if (!audioCtx || audioCtx.state === 'closed') {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error('AudioContext unavailable');
      audioCtx = new Ctx();
    }
    if (audioCtx.state === 'suspended' && !isPaused) {
      await audioCtx.resume();
    }
    if (token !== playbackToken) return;

    const buffer = audioCtx.createBuffer(1, audio.pcm.length, audio.sampleRate);
    buffer.getChannelData(0).set(audio.pcm);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(ensureAudioGraph(audioCtx));
    activeSources.add(source);

    const startAt = Math.max(audioCtx.currentTime + 0.02, nextStartTime);
    nextStartTime = startAt + buffer.duration + CHUNK_GAP_SEC;

    source.onended = () => {
      activeSources.delete(source);
      maybeFinish();
    };
    source.start(startAt);

    if (!firstFired) {
      firstFired = true;
      onFirstAudio();
    }
  };

  const finish = () => {
    streamDone = true;
    maybeFinish();
  };

  return { pushChunk, finish };
}

export async function pauseAudio(engine: EngineKind | null): Promise<void> {
  isPaused = true;
  if (engine === 'kokoro' && audioCtx && audioCtx.state === 'running') {
    await audioCtx.suspend();
  } else if (engine === 'speech' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.pause();
  }
}

export async function resumeAudio(engine: EngineKind | null): Promise<void> {
  isPaused = false;
  if (engine === 'kokoro' && audioCtx && audioCtx.state === 'suspended') {
    await audioCtx.resume();
  } else if (engine === 'speech' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.resume();
  }
}

function pickBestVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  if (english.length === 0) return voices[0] ?? null;
  const preferred = /(natural|enhanced|premium|google|samantha|daniel|karen|arthur|serena)/i;
  return english.find((v) => preferred.test(v.name)) ?? english.find((v) => v.localService) ?? english[0];
}

function splitForSpeech(text: string): string[] {
  const sentences = (text.match(/[^.!?]+[.!?…]*/g) ?? [text])
    .map((p) => p.trim())
    .filter(Boolean);
  // Keep utterances short enough to avoid Chromium's ~15s speechSynthesis stall bug.
  const chunks: string[] = [];
  for (const s of sentences) {
    if (s.length <= 160) {
      chunks.push(s);
    } else {
      const sub = s.match(/[^,;]+[,;]*/g) ?? [s];
      chunks.push(...sub.map((p) => p.trim()).filter(Boolean));
    }
  }
  return chunks;
}

export function playNativeSpeech(text: string, onEnded: () => void, onError: (err: Error) => void): void {
  stopActiveAudio();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    onError(new Error('Browser speech synthesis unavailable'));
    return;
  }

  const token = ++speechToken;
  const chunks = splitForSpeech(text);
  let idx = 0;

  const speakNext = () => {
    if (token !== speechToken) return;
    if (idx >= chunks.length) {
      onEnded();
      return;
    }
    const utter = new SpeechSynthesisUtterance(chunks[idx++]);
    const voice = pickBestVoice();
    if (voice) utter.voice = voice;
    utter.rate = 1.02;
    utter.onend = speakNext;
    utter.onerror = (e) => {
      if (token !== speechToken) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      onError(new Error(`Speech error: ${e.error}`));
    };
    window.speechSynthesis.speak(utter);
  };

  speakNext();
}

export function markKokoroFailed(): void {
  workerFailed = true;
}
