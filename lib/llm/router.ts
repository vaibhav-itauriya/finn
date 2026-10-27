// Model router. Three tiers, picked per task, not per app:
//   bulk   -> cheapest model: classification fallbacks, line-item extraction from PDFs
//   reason -> stronger model: promise-vs-delivered judgement, bull/bear synthesis
//   search -> grounded web search: only for push-side enrichment (who is the new CFO?)
// Everything is cached by content, and every call is metered so the UI can show what a run cost.
import { readFileSync } from "node:fs";
import path from "node:path";
import { cached, cacheKey } from "../cache";
import { sleep } from "../util/http";

export type LLMTier = "bulk" | "reason" | "search";

// Google retires model names often, so the chains are built from data/models.json (written by the
// pipeline from the ListModels API) when present: newest Flash-Lite for bulk, newest Flash for
// reasoning. Env vars override. Each tier ends with the other tier's models as a last resort, so a
// spent daily quota degrades quality instead of breaking the feature.
const version = (n: string) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
function available(): string[] {
  try {
    const list = JSON.parse(readFileSync(path.join(process.cwd(), "data", "models.json"), "utf8")) as { name: string }[];
    return list
      .map((m) => m.name)
      .filter((n) => /^gemini-\d/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|embed|exp|thinking|computer|robot|native)/.test(n));
  } catch {
    return [];
  }
}
function buildChains(): Record<LLMTier, string[]> {
  const av = available().sort((a, b) => version(b) - version(a) || Number(/preview/.test(a)) - Number(/preview/.test(b)));
  const lite = av.filter((n) => /lite/.test(n));
  const flash = av.filter((n) => !/lite/.test(n));
  const uniq = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
  const bulk = uniq([process.env.FINN_MODEL_BULK, ...lite.slice(0, 2), "gemini-flash-lite-latest", "gemini-2.5-flash-lite"]);
  const reason = uniq([process.env.FINN_MODEL_REASON, ...flash.slice(0, 5), "gemini-flash-latest", "gemini-2.5-flash"]);
  // Open-weights Gemma on the same API has a far larger free allowance: last resort for text work.
  const open = ["gemma-4-31b-it"];
  return {
    bulk: uniq([...bulk, ...open, ...reason]),
    reason: uniq([...reason, ...bulk, ...open]),
    search: uniq([process.env.FINN_MODEL_SEARCH, ...reason]),
  };
}
let chains: Record<LLMTier, string[]> | null = null;
const MODELS = new Proxy({} as Record<LLMTier, string[]>, { get: (_, k: LLMTier) => (chains ??= buildChains())[k] });

// USD per 1M tokens (paid-tier list prices), used only to report what the free-tier run *would* cost.
const PRICE: Record<string, [number, number]> = {
  // Unknown newer models are priced by family below (see priceOf).
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
  const gemma = model.startsWith("gemma");
  const parts = gemma && req.system ? [{ text: req.system }, ...req.parts] : req.parts;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: gemma && req.json ? [...parts, { text: "Reply with JSON only." }] : parts }],
    generationConfig: {
      temperature: req.temperature ?? 0.1,
      maxOutputTokens: req.maxOutputTokens ?? 4096,
      ...(req.json && req.tier !== "search" && !gemma ? { responseMimeType: "application/json" } : {}),
      ...(req.schema && req.tier !== "search" && !gemma ? { responseSchema: req.schema } : {}),
    },
  };
  if (req.system && !gemma) body.systemInstruction = { parts: [{ text: req.system }] };
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
        const [pi, po] = PRICE[model] || (/lite/.test(model) ? [0.1, 0.4] : [0.3, 2.5]);
        meter.usd += (r.tin * pi + r.tout * po) / 1e6;
        return { text: r.text, model: r.model, cached: false, sources: r.sources };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number }).status;
        if (status === 404 || (e as { daily?: boolean }).daily) deadModels.add(model); // retired or out of quota for today
        if (status !== 404 && status !== 400 && status !== 422 && status !== 429) throw e; // otherwise try the next model
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(`No ${req.tier} model available right now (quotas spent or models retired)`);
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
