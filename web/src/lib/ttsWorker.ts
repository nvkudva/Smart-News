import { KokoroTTS, TextSplitterStream } from 'kokoro-js';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

type ProgressInfo = {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
};

type WorkerIn =
  | { type: 'init' }
  | { type: 'synthesize'; id: number; text: string; voice?: string; speed?: number }
  | { type: 'cancel'; id: number };

type WorkerOut =
  | { type: 'progress'; percent: number }
  | { type: 'ready' }
  | { type: 'chunk'; id: number; pcm: ArrayBuffer; sampleRate: number }
  | { type: 'done'; id: number }
  | { type: 'error'; id?: number; message: string };

function post(msg: WorkerOut, transfer?: Transferable[]) {
  (self as unknown as { postMessage: (m: WorkerOut, t?: Transferable[]) => void })
    .postMessage(msg, transfer);
}

const yieldMacrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let modelPromise: Promise<KokoroTTS> | null = null;
const fileBytes = new Map<string, { loaded: number; total: number }>();
const cancelledIds = new Set<number>();
let lastPercent = -1;

function reportProgress(info: ProgressInfo) {
  if (info.status !== 'progress' || !info.file || !info.total) return;
  fileBytes.set(info.file, { loaded: info.loaded ?? 0, total: info.total });
  let loaded = 0;
  let total = 0;
  for (const entry of fileBytes.values()) {
    loaded += entry.loaded;
    total += entry.total;
  }
  if (total > 0) {
    const percent = Math.min(99, Math.round((loaded / total) * 100));
    if (percent !== lastPercent) {
      lastPercent = percent;
      post({ type: 'progress', percent });
    }
  }
}

function getModel(): Promise<KokoroTTS> {
  if (modelPromise) return modelPromise;
  modelPromise = KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: reportProgress as unknown as Parameters<typeof KokoroTTS.from_pretrained>[1] extends { progress_callback?: infer C } ? C : never,
  }).then((tts) => {
    post({ type: 'ready' });
    return tts;
  }).catch((err) => {
    modelPromise = null;
    throw err;
  });
  return modelPromise;
}

function splitSentences(text: string): string[] {
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  const out: string[] = [];
  for (const sentence of splitter) {
    if (sentence.length <= 160) {
      out.push(sentence);
    } else {
      const parts = sentence.split(/(?<=[;:])\s+|\s+—\s+/).map((p) => p.trim()).filter(Boolean);
      out.push(...(parts.length > 0 ? parts : [sentence]));
    }
  }
  return out;
}

async function synthesize(id: number, text: string, voice: string, speed: number) {
  // Yield before work so any queued cancel message arrives before starting synthesis.
  await yieldMacrotask();
  if (cancelledIds.has(id)) {
    cancelledIds.delete(id);
    return;
  }

  const tts = await getModel();
  await yieldMacrotask();
  if (cancelledIds.has(id)) {
    cancelledIds.delete(id);
    return;
  }

  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    await yieldMacrotask();
    if (cancelledIds.has(id)) {
      cancelledIds.delete(id);
      return;
    }

    const audio = await tts.generate(sentence, { voice: voice as never, speed });
    await yieldMacrotask();
    if (cancelledIds.has(id)) {
      cancelledIds.delete(id);
      return;
    }

    const copy = new Float32Array(audio.audio);
    post({
      type: 'chunk',
      id,
      pcm: copy.buffer as ArrayBuffer,
      sampleRate: audio.sampling_rate,
    }, [copy.buffer]);
  }

  cancelledIds.delete(id);
  post({ type: 'done', id });
}

// Serialize inference calls: ONNX Runtime WASM sessions cannot run concurrent forwards safely.
let queue: Promise<void> = Promise.resolve();

self.addEventListener('message', (event: MessageEvent<WorkerIn>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelledIds.add(msg.id);
    return;
  }
  if (msg.type === 'init') {
    queue = queue.then(() => getModel().then(() => undefined)).catch((err) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
    return;
  }
  if (msg.type === 'synthesize') {
    queue = queue
      .then(() => synthesize(msg.id, msg.text, msg.voice ?? 'af_heart', msg.speed ?? 1))
      .catch((err) => {
        cancelledIds.delete(msg.id);
        post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      });
  }
});
