// Orchestrates the research view. Each step is independently callable so the UI can stream
// sections in as they finish (numbers in ~1s, call notes in parallel, judgement last),
// and so every step fits comfortably inside a serverless time limit.
import { promises as fs } from "node:fs";
import path from "node:path";
import { cached, cacheKey } from "../cache";
import { llm } from "../llm/router";
import { fetchScreener, fetchScreenerPrices, type ScreenerCompany } from "../sources/screener";
import { fetchEOD } from "../sources/yahoo";
import { annualReportRefs, bseTranscripts, docPages, extractCall, pickTranscripts, retrieve, type CallExtract, type TranscriptRef } from "./calls";
import { buildLedger, buildThesis, type Ledger, type Thesis } from "./ledger";
import { buildNumbers, type NumbersView } from "./numbers";

export interface ResearchReport {
  ticker: string;
  generatedAt: string;
  numbers: NumbersView;
  transcripts: TranscriptRef[];
  calls: CallExtract[];
  ledger: Ledger | null;
  thesis: Thesis | null;
  errors: string[];
}

const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

export async function company(ticker: string): Promise<ScreenerCompany> {
  // Screener refreshes daily at most; one fetch per ticker per day.
  const { value } = await cached("screener", cacheKey(ticker.toUpperCase(), today()), () => fetchScreener(ticker));
  return value;
}

/** Precomputed report shipped with the app (demo companies), if any. */
export async function snapshot(ticker: string): Promise<ResearchReport | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "research", `${ticker.toUpperCase()}.json`), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Source documents for the promise check: Screener's transcript links merged with the exchange
 * copies. Some companies (OFSS, for one) never hold earnings calls, and some hold one a year, so
 * the latest annual reports fill in: management's own outlook, judged the same way.
 */
export async function transcripts(ticker: string): Promise<TranscriptRef[]> {
  const sc = await company(ticker);
  const { value } = await cached("screener", cacheKey("transcripts-v4", ticker.toUpperCase(), today()), async () => {
    const calls = pickTranscripts(sc, 4, await bseTranscripts(sc.bse));
    return calls.length >= 2 ? calls : [...calls, ...annualReportRefs(sc, 2 - calls.length)];
  });
  return value;
}

export async function stepNumbers(ticker: string) {
  const sc = await company(ticker);
  return { numbers: buildNumbers(sc), transcripts: await transcripts(ticker) };
}

/** Five years of daily closes for the share-price chart. Refreshed every few hours. */
export async function stepPrice(ticker: string) {
  const sc = await company(ticker);
  const bucket = Math.floor(new Date(Date.now() + 5.5 * 3600e3).getUTCHours() / 4);
  const { value } = await cached("screener", cacheKey("price-v1", ticker.toUpperCase(), today(), String(bucket)), async () => {
    const errs: string[] = [];
    const tries: [string, () => Promise<{ d: string; c: number; v: number }[]>][] = [];
    if (sc.nse) tries.push(["yahoo-nse", () => fetchEOD(sc.nse!, "5y")]);
    if (sc.bse) tries.push(["yahoo-bse", () => fetchEOD(String(sc.bse), "5y", ".BO")]);
    if (sc.companyId) tries.push(["screener", () => fetchScreenerPrices(sc.companyId!)]);
    for (const [src, f] of tries) {
      try {
        const bars = await f();
        if (bars.length > 20) return { source: src, bars: bars.map((b) => [b.d, b.c, b.v] as [string, number, number]) };
      } catch (e) {
        errs.push(`${src}: ${(e as Error).message.slice(0, 60)}`);
      }
    }
    throw new Error(`No price history (${errs.join("; ") || "no listing found"})`);
  });
  return value;
}

export async function stepCall(ticker: string, i: number): Promise<CallExtract> {
  const sc = await company(ticker);
  const t = (await transcripts(ticker))[i];
  if (!t) throw new Error(`No transcript #${i} for ${ticker}`);
  return extractCall(t, i === 0);
}

async function allCalls(ticker: string): Promise<CallExtract[]> {
  const sc = await company(ticker);
  const ts = await transcripts(ticker);
  const out: CallExtract[] = [];
  for (let i = 0; i < ts.length; i++) {
    try {
      out.push(await extractCall(ts[i], i === 0)); // cached after first run
    } catch (e) {
      console.error(`call ${ticker} #${i}:`, (e as Error).message);
    }
  }
  return out;
}

// The browser already holds the call extracts it just streamed in, so it sends them back for the
// judgement steps. That keeps these requests independent of which serverless instance served the
// extraction (no shared cache needed for the live path).
export async function stepLedger(ticker: string, given?: CallExtract[]): Promise<Ledger> {
  const [{ numbers }, calls] = await Promise.all([stepNumbers(ticker), given?.length ? given : allCalls(ticker)]);
  if (calls.length < 1) throw new Error("No transcripts could be read");
  return buildLedger(calls, numbers);
}

export async function stepThesis(ticker: string, given?: CallExtract[]): Promise<Thesis> {
  const [{ numbers }, calls] = await Promise.all([stepNumbers(ticker), given?.length ? given : allCalls(ticker)]);
  if (!calls.length) throw new Error("No transcripts available");
  return buildThesis(calls, numbers);
}

export async function ask(ticker: string, question: string) {
  const sc = await company(ticker);
  const ts = await transcripts(ticker);
  const docs = await Promise.all(
    ts.map(async (t) => ({ quarter: t.label, url: t.url, pages: await docPages(t).catch(() => [] as string[]) })),
  );
  const hits = retrieve(docs, question, 6);
  if (!hits.length) return { answer: "Nothing in the documents FINN read addresses this.", cites: [] };
  const ctx = hits.map((h, i) => `[S${i + 1}] ${h.quarter} call, p.${h.page}:\n${h.text.slice(0, 3500)}`).join("\n\n");
  const r = await llm({
    tier: "bulk",
    parts: [
      {
        text: `Answer the investor's question about ${sc.name} using ONLY the excerpts from its own earnings calls and annual reports. Max 80 words, numbers first. Cite like [S1]. If the excerpts don't answer it, say so in one line.\nQuestion: ${question}\n\n${ctx}`,
      },
    ],
    cacheId: `ask-v1|${ticker}|${question.toLowerCase().trim()}|${ts.map((t) => t.url).join(",")}`,
    maxOutputTokens: 600,
  });
  return { answer: r.text.trim(), cites: hits.map((h, i) => ({ id: `S${i + 1}`, quarter: h.quarter, page: h.page, url: h.url })) };
}

/** Full report (used by the precompute script for demo companies). */
export async function fullReport(ticker: string): Promise<ResearchReport> {
  const errors: string[] = [];
  const { numbers, transcripts } = await stepNumbers(ticker);
  const calls = await allCalls(ticker);
  let ledger: Ledger | null = null;
  let thesis: Thesis | null = null;
  try {
    if (calls.length >= 1) ledger = await buildLedger(calls, numbers);
  } catch (e) {
    errors.push(`ledger: ${(e as Error).message.slice(0, 200)}`);
  }
  try {
    if (calls.length) thesis = await buildThesis(calls, numbers);
  } catch (e) {
    errors.push(`thesis: ${(e as Error).message.slice(0, 200)}`);
  }
  return { ticker: ticker.toUpperCase(), generatedAt: new Date().toISOString(), numbers, transcripts, calls, ledger, thesis, errors };
}
