// Model router. Three tiers, picked per task, not per app:
//   bulk   -> cheapest model: classification fallbacks, line-item extraction from PDFs
//   reason -> stronger model: promise-vs-delivered judgement, bull/bear synthesis
//   search -> grounded web search: only for push-side enrichment (who is the new CFO?)
// Everything is cached by content, and every call is metered so the UI can show what a run cost.
import { cached, cacheKey } from "../cache";
import { sleep } from "../util/http";

export type LLMTier = "bulk" | "reason" | "search";

const MODELS: Record<LLMTier, string[]> = {
  bulk: [process.env.FINN_MODEL_BULK || "gemini-2.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.0-flash-lite"],
  reason: [process.env.FINN_MODEL_REASON || "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"],
  search: [process.env.FINN_MODEL_SEARCH || "gemini-2.5-flash", "gemini-flash-latest", "gemini-2.0-flash"],
};

// USD per 1M tokens (paid-tier list prices), used only to report what the free-tier run *would* cost.
const PRICE: Record<string, [number, number]> = {
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "gemini-flash-lite-latest": [0.1, 0.4],
  "gemini-2.0-flash-lite": [0.075, 0.3],
  "gemini-2.5-flash": [0.3, 2.5],
  "gemini-flash-latest": [0.3, 2.5],
  "gemini-2.0-flash": [0.1, 0.4],
};

export interface Meter {
  calls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  usd: number;
  models: Record<string, number>;
}

const deadModels = new Set<string>();
let llmLog: (s: string) => void = () => {};
export function setLLMLogger(fn: (s: string) => void) {
  llmLog = fn;
}

export const meter: Meter = { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, usd: 0, models: {} };

export function resetMeter() {
  Object.assign(meter, { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, usd: 0, models: {} });
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export interface LLMRequest {
  tier: LLMTier;
  system?: string;
  parts: Part[];
  json?: boolean; // ask for application/json output
  schema?: object; // optional Gemini responseSchema
  temperature?: number;
  /** Stable identity for caching, e.g. "results-v3|<pdf url>". Omit to skip caching. */
  cacheId?: string;
  maxOutputTokens?: number;
}

export interface LLMResponse {
  text: string;
  model: string;
  cached: boolean;
  sources?: { title: string; url: string }[];
}

export function hasLLM() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function callGemini(model: string, req: LLMRequest): Promise<LLMResponse & { tin: number; tout: number }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: req.parts }],
    generationConfig: {
      temperature: req.temperature ?? 0.1,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
      ...(req.json && req.tier !== "search" ? { responseMimeType: "application/json" } : {}),
      ...(req.schema && req.tier !== "search" ? { responseSchema: req.schema } : {}),
    },
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  if (req.tier === "search") body.tools = [{ google_search: {} }];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 100_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 3) throw e;
      await sleep(2000);
      continue;
    }
    clearTimeout(timer);
    if (res.status === 429 || res.status === 503) {
      const txt = await res.text();
      // A daily quota won't recover by waiting: give up on this model now and let the router
      // fall back to the next one (separate quota bucket).
      if (res.status === 429 && /per ?day|PerDay|daily/i.test(txt)) {
        llmLog(`${model}: daily quota exhausted, falling back`);
        throw Object.assign(new Error(`${model} daily quota exhausted`), { status: 429, daily: true });
      }
      // Per-minute limit: honour the server's hint, capped, at most 3 times.
      const m = txt.match(/"retryDelay":\s*"(\d+)s"/);
      const wait = Math.min(30_000, m ? Number(m[1]) * 1000 + 500 : 4000 * (attempt + 1));
      llmLog(`${model}: ${res.status}, waiting ${Math.round(wait / 1000)}s`);
      if (attempt >= 2) throw Object.assign(new Error(`${model} rate limited`), { status: 429 });
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`Gemini ${model} ${res.status}: ${txt.slice(0, 300)}`) as Error & { status: number };
      err.status = res.status;
      throw err;
    }
    const j = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string }[] };
        groundingMetadata?: { groundingChunks?: { web?: { uri: string; title: string } }[] };
      }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title: string } => Boolean(w?.uri))
      .map((w) => ({ title: w.title, url: w.uri }));
    const tin = j.usageMetadata?.promptTokenCount || 0;
    const tout = (j.usageMetadata?.candidatesTokenCount || 0) + (j.usageMetadata?.thoughtsTokenCount || 0);
    return { text, model, cached: false, sources, tin, tout };
  }
  throw new Error(`Gemini ${model}: still rate limited after retries`);
}

export async function llm(req: LLMRequest): Promise<LLMResponse> {
  const run = async (): Promise<LLMResponse> => {
    let lastErr: unknown;
    for (const model of MODELS[req.tier].filter((m) => !deadModels.has(m))) {
      try {
        let r = await callGemini(model, req);
        // Never cache a reply we can't parse: retry once, then give up loudly.
        if (req.json && !isJSON(r.text)) r = await callGemini(model, { ...req, temperature: 0 });
        if (req.json && !isJSON(r.text)) throw Object.assign(new Error(`${model} returned unparseable JSON`), { status: 422 });
        meter.calls++;
        meter.tokensIn += r.tin;
        meter.tokensOut += r.tout;
        meter.models[model] = (meter.models[model] || 0) + 1;
        const [pi, po] = PRICE[model] || [0.3, 2.5];
        meter.usd += (r.tin * pi + r.tout * po) / 1e6;
        return { text: r.text, model: r.model, cached: false, sources: r.sources };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number }).status;
        if (status === 404 || (e as { daily?: boolean }).daily) deadModels.add(model); // retired or out of quota for today
        if (status !== 404 && status !== 400 && status !== 422 && status !== 429) throw e; // otherwise try the next model
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  };
  if (!req.cacheId) return run();
  const { value, hit } = await cached("llm", cacheKey(req.tier, req.cacheId), run);
  if (hit) meter.cacheHits++;
  return { ...value, cached: hit };
}

function isJSON(t: string) {
  try {
    parseJSON(t);
    return true;
  } catch {
    return false;
  }
}

/** Parse JSON from a model reply, tolerating ```json fences and trailing prose. */
export function parseJSON<T>(text: string): T {
  const t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(t) as T;
  } catch {
    const s = t.indexOf("{");
    const a = t.indexOf("[");
    const start = s === -1 ? a : a === -1 ? s : Math.min(s, a);
    const end = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1)) as T;
    throw new Error("Model did not return JSON: " + t.slice(0, 200));
  }
}

export function pdfPart(bytes: Uint8Array): Part {
  return { inline_data: { mime_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } };
}
