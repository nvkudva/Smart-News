import { GoogleGenAI } from '@google/genai';

/**
 * One JSON-returning completion call, over three interchangeable back ends.
 * Everything provider-specific lives here; callers pass a plain JSON Schema.
 *
 *   LLM_PROVIDER  cloudflare (default) | gemini | deepseek | openai
 *   LLM_MODEL     model id; each provider has a sane default
 *   LLM_BASE_URL  for provider=openai — any OpenAI-compatible endpoint
 *                 (OpenRouter, Together, vLLM, Ollama, LM Studio, …)
 *   LLM_API_KEY   falls back to the provider's own key env var
 *                 (CLOUDFLARE_API_TOKEN / GEMINI_API_KEY / DEEPSEEK_API_KEY /
 *                 OPENAI_API_KEY). Cloudflare also needs CLOUDFLARE_ACCOUNT_ID.
 *   LLM_RPM       requests per minute to pace at (free tiers are strict)
 *   LLM_JSON_MODE how to ask for JSON on the OpenAI-compatible path:
 *                 schema (default) | object | text. LM Studio and OpenAI want
 *                 json_schema; DeepSeek and most gateways want json_object;
 *                 text puts the schema in the prompt only, for servers with
 *                 no structured-output support at all.
 */

export type JsonSchema = {
  type: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array';
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: readonly string[];
  nullable?: boolean;
  required?: readonly string[];
  description?: string;
};

export type Provider = 'cloudflare' | 'gemini' | 'deepseek' | 'openai';

export type JsonMode = 'schema' | 'object' | 'text';

export type LlmConfig = {
  provider: Provider; model: string; apiKey: string;
  baseUrl?: string; rpm: number; jsonMode: JsonMode;
};

const DEFAULTS: Record<Provider, { model: string; baseUrl?: string; rpm: number; keyEnv: string }> = {
  // Workers AI. gpt-oss-20b over llama-3.1-8b: the 8b returned unusable JSON on
  // 2 of 3 real clusters, and qwen3-30b is a reasoning model that leaves
  // `content` null and puts everything in `reasoning`.
  cloudflare: { model: '@cf/openai/gpt-oss-20b', rpm: 100, keyEnv: 'CLOUDFLARE_API_TOKEN' },
  gemini:   { model: 'gemini-2.5-flash', rpm: 8,  keyEnv: 'GEMINI_API_KEY' },
  deepseek: { model: 'deepseek-v4-flash', baseUrl: 'https://api.deepseek.com/v1', rpm: 45, keyEnv: 'DEEPSEEK_API_KEY' },
  openai:   { model: 'gpt-4o-mini',   baseUrl: 'https://api.openai.com/v1',   rpm: 45, keyEnv: 'OPENAI_API_KEY' },
};

export function llmConfig(): LlmConfig | null {
  const provider = (process.env.LLM_PROVIDER ?? 'cloudflare').toLowerCase() as Provider;
  const d = DEFAULTS[provider];
  if (!d) throw new Error(`Unknown LLM_PROVIDER "${provider}" — use cloudflare, gemini, deepseek or openai.`);
  const apiKey = process.env.LLM_API_KEY ?? process.env[d.keyEnv] ?? '';
  if (!apiKey) return null;

  let baseUrl = process.env.LLM_BASE_URL ?? d.baseUrl;
  if (provider === 'cloudflare' && !process.env.LLM_BASE_URL) {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!account) throw new Error('LLM_PROVIDER=cloudflare needs CLOUDFLARE_ACCOUNT_ID.');
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${account}/ai/v1`;
  }

  return {
    provider,
    model: process.env.LLM_MODEL ?? process.env.GEMINI_MODEL ?? d.model,
    apiKey,
    baseUrl,
    rpm: Number(process.env.LLM_RPM ?? process.env.GEMINI_RPM ?? d.rpm),
    // Workers AI accepts a response_format but does not enforce a schema, and
    // DeepSeek rejects json_schema outright; both are reliable with json_object.
    jsonMode: (process.env.LLM_JSON_MODE
      ?? (provider === 'deepseek' || provider === 'cloudflare' ? 'object' : 'schema')) as JsonMode,
  };
}

export function describe(c: LlmConfig): string {
  if (c.provider === 'gemini') return `gemini/${c.model}`;
  if (c.provider === 'cloudflare') return `cloudflare/${c.model}`;
  return `${c.provider}/${c.model} @ ${c.baseUrl} (json:${c.jsonMode})`;
}

// ---------------------------------------------------------------- pacing ---

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;

/** Serialises callers into evenly spaced slots so we stay under the RPM cap. */
async function takeSlot(rpm: number) {
  const gap = Math.ceil(60_000 / Math.max(1, rpm));
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + gap;
  if (at > now) await sleep(at - now);
}

export type LlmError = 'rate_limit' | 'unavailable' | 'auth' | 'empty' | 'bad_json' | 'other';
export const errorTally = new Map<LlmError, number>();
const bump = (k: LlmError) => errorTally.set(k, (errorTally.get(k) ?? 0) + 1);

function classify(status: number | undefined): LlmError {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 500 || status === 502 || status === 503 || status === 504) return 'unavailable';
  return 'other';
}

/** Providers that tell us how long to wait are worth listening to. */
function backoffMs(message: string, attempt: number): number {
  const m = message.match(/retry in ([\d.]+)\s*s/i);
  if (m) return Math.min(60_000, Math.ceil(Number(m[1]) * 1000) + 500);
  return Math.min(60_000, 2000 * 2 ** attempt);
}

const MAX_RETRIES = 4;

// -------------------------------------------------------------- back ends ---

/**
 * Plain JSON Schema for the OpenAI-compatible path. A nullable field becomes an
 * *optional* one rather than a `["string","null"]` union: LM Studio's grammar
 * builder rejects union types outright, and callers already treat absent as null.
 */
function toOpenAiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type };
  if (s.enum) out.enum = [...s.enum];
  if (s.description) out.description = s.description;
  if (s.items) out.items = toOpenAiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toOpenAiSchema(v)]),
    );
    out.required = Object.entries(s.properties)
      .filter(([, v]) => !v.nullable)
      .map(([k]) => k);
    out.additionalProperties = false;
  }
  return out;
}

/** Gemini's responseSchema wants SCREAMING type names and no `required` on leaves. */
function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.enum) out.enum = [...s.enum];
  if (s.nullable) out.nullable = true;
  if (s.description) out.description = s.description;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (s.required) out.required = [...s.required];
  return out;
}

let gemini: GoogleGenAI | null = null;

async function callGemini(c: LlmConfig, system: string, user: string, schema: JsonSchema): Promise<string> {
  gemini ??= new GoogleGenAI({ apiKey: c.apiKey });
  const res = await gemini.models.generateContent({
    model: c.model,
    contents: user,
    config: {
      systemInstruction: system,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema) as never,
      temperature: 0.2,
      maxOutputTokens: 2048,
    },
  });
  return res.text ?? '';
}

async function callOpenAiCompatible(c: LlmConfig, system: string, user: string, schema: JsonSchema): Promise<string> {
  const responseFormat =
    c.jsonMode === 'schema'
      ? { response_format: { type: 'json_schema',
            json_schema: { name: 'result', strict: false, schema: toOpenAiSchema(schema) } } }
      : c.jsonMode === 'object'
        ? { response_format: { type: 'json_object' } }
        : {};

  const res = await fetch(`${c.baseUrl!.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: c.model,
      temperature: 0.2,
      max_tokens: 2048,
      ...responseFormat,
      messages: [
        { role: 'system', content: `${system}\n\nReply with JSON matching this schema:\n${JSON.stringify(schema)}` },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = await res.json() as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? '';
}

// ------------------------------------------------------------------- api ---

export async function completeJson<T>(
  system: string, user: string, schema: JsonSchema, config = llmConfig(),
): Promise<T | null> {
  if (!config) return null;

  let text = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await takeSlot(config.rpm);
    try {
      text = config.provider === 'gemini'
        ? await callGemini(config, system, user, schema)
        : await callOpenAiCompatible(config, system, user, schema);
      break;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const kind = classify(status);
      if (kind === 'auth' || kind === 'other' || attempt === MAX_RETRIES) { bump(kind); return null; }
      await sleep(backoffMs(String((err as Error).message ?? ''), attempt));
    }
  }

  if (!text.trim()) { bump('empty'); return null; }
  const slice = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    return JSON.parse(slice) as T;
  } catch {
    bump('bad_json');
    return null;
  }
}
