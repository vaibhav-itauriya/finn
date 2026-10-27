// Map step of the research engine: read each concall transcript ONCE with the cheap model and
// pull out structured guidance, what management says was delivered, tone and analyst pushback.
// Transcripts never change, so each extraction is cached forever and shared by every user.
// Quotes are string-matched against the PDF text afterwards: anything the model can't
// point to verbatim is marked unverified, which is how we keep the "no AI slop" promise.
import { cached, cacheKey } from "../cache";
import { llm, parseJSON } from "../llm/router";
import { fetchPdf, pdfPages } from "../sources/pdf";
import type { ScreenerCompany } from "../sources/screener";

export interface TranscriptRef {
  label: string; // Screener's month label, e.g. "Oct 2026"
  url: string;
}

export interface GuidanceItem {
  metric: "revenue" | "margin" | "profit" | "capex" | "volume" | "orders" | "other";
  statement: string; // short paraphrase
  quote: string; // verbatim, <= 30 words
  page: number;
  horizon: string; // "FY27", "next 2-3 years", "Q3"
  quantitative: boolean;
  verified?: boolean;
}

export interface CallExtract {
  url: string;
  quarter: string; // "Q2 FY27"
  callDate: string | null;
  pages: number;
  guidance: GuidanceItem[];
  delivered: { metric: string; statement: string; page: number }[];
  tone: string;
  pushback: { topic: string; gist: string; page: number }[];
  business: { summary: string; segments: { name: string; share: string | null; note: string }[]; page: number } | null;
}

export function pickTranscripts(sc: ScreenerCompany, n = 4): TranscriptRef[] {
  const seen = new Set<string>();
  const out: TranscriptRef[] = [];
  for (const c of sc.concalls) {
    if (!c.transcript || seen.has(c.transcript)) continue;
    seen.add(c.transcript);
    out.push({ label: c.label, url: c.transcript });
    if (out.length >= n) break;
  }
  return out;
}

/** Page texts for a PDF, cached (re-used by extraction and by the Ask box). */
export async function transcriptPages(url: string): Promise<string[]> {
  const { value } = await cached("pages", cacheKey("pages-v1", url), async () => pdfPages(await fetchPdf(url)));
  return value;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"'’‘]/g, "")
    .replace(/[^a-z0-9%.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** True if the quote (or its first 10 words) appears in the document. */
export function verifyQuote(quote: string, pages: string[], page?: number): { ok: boolean; page?: number } {
  const q = norm(quote);
  if (q.length < 12) return { ok: false };
  const probe = q.split(" ").slice(0, 10).join(" ");
  const order = page ? [page - 1, ...pages.map((_, i) => i).filter((i) => i !== page - 1)] : pages.map((_, i) => i);
  for (const i of order) {
    const p = norm(pages[i] || "");
    if (p.includes(q) || p.includes(probe)) return { ok: true, page: i + 1 };
  }
  return { ok: false };
}

const EXTRACT_PROMPT = (withBusiness: boolean) => `You are an equity analyst reading an Indian listed company's earnings-call transcript. Pages are marked [[p.N]].
Use ONLY this transcript. Do not use outside knowledge.
Return JSON:
{
 "quarter": "Q<n> FY<yy>" (the quarter being discussed; Indian FY starts in April, so Jul-Sep 2026 is Q2 FY27),
 "callDate": "YYYY-MM-DD" or null,
 "guidance": [ forward-looking commitments by MANAGEMENT about revenue/growth, margins, profit, capex, volumes, order book, or other targets.
   {"metric": "revenue|margin|profit|capex|volume|orders|other", "statement": "<=20 words, plain English, include the number", "quote": "<=30 words copied EXACTLY from the transcript", "page": N, "horizon": "e.g. FY27 / next quarter / medium term", "quantitative": true if a number or range is given} ],
 "delivered": [ what management says was achieved THIS quarter on the same kinds of metrics: {"metric": "...", "statement": "<=20 words with numbers", "page": N} ],
 "tone": "<=20 words: management's overall stance, e.g. 'confident on demand, cautious on margins'",
 "pushback": [ topics analysts pressed on repeatedly or sceptically: {"topic": "<=5 words", "gist": "<=20 words", "page": N} ]${
   withBusiness
     ? `,
 "business": {"summary": "<=40 words: what the company does and how it makes money, from management's opening remarks", "segments": [{"name": "...", "share": "share of revenue if stated, else null", "note": "<=12 words"}], "page": N}`
     : ""
 }
}
Keep at most 8 guidance items (the most important, quantitative first), 6 delivered items and 4 pushback items. Quotes must be verbatim.`;

export async function extractCall(t: TranscriptRef, withBusiness = false): Promise<CallExtract> {
  const pages = await transcriptPages(t.url);
  const body = pages.map((p, i) => `[[p.${i + 1}]]\n${p}`).join("\n\n").slice(0, 180_000);
  const r = await llm({
    tier: "bulk",
    parts: [{ text: EXTRACT_PROMPT(withBusiness) }, { text: body }],
    json: true,
    cacheId: `call-v2|${withBusiness ? "b" : ""}|${t.url}`,
    maxOutputTokens: 4096,
  });
  const x = parseJSON<Omit<CallExtract, "url" | "pages">>(r.text);
  const guidance = (x.guidance || []).map((g) => {
    const v = verifyQuote(g.quote || "", pages, g.page);
    return { ...g, page: v.page ?? g.page, verified: v.ok };
  });
  return {
    url: t.url,
    quarter: x.quarter || t.label,
    callDate: x.callDate ?? null,
    pages: pages.length,
    guidance,
    delivered: x.delivered || [],
    tone: x.tone || "",
    pushback: x.pushback || [],
    business: withBusiness ? x.business ?? null : null,
  };
}

/** Simple keyword retrieval over transcript pages for the Ask box (no vector DB needed at this size). */
export function retrieve(pagesByDoc: { quarter: string; url: string; pages: string[] }[], question: string, k = 6) {
  const stop = new Set("the a an of to in on for and or is are was were be what how why did does do with by at as it its this that from".split(" "));
  const terms = norm(question)
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w));
  const scored: { quarter: string; url: string; page: number; text: string; score: number }[] = [];
  for (const d of pagesByDoc) {
    d.pages.forEach((p, i) => {
      const t = norm(p);
      let s = 0;
      for (const w of terms) {
        const m = t.split(w).length - 1;
        if (m) s += 1 + Math.log(1 + m);
      }
      if (s > 0) scored.push({ quarter: d.quarter, url: d.url, page: i + 1, text: p, score: s });
    });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}
