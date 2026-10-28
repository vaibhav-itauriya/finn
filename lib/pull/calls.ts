// Map step of the research engine: read each concall transcript ONCE with the cheap model and
// pull out structured guidance, what management says was delivered, tone and analyst pushback.
// Transcripts never change, so each extraction is cached forever and shared by every user.
// Quotes are string-matched against the PDF text afterwards: anything the model can't
// point to verbatim is marked unverified, which is how we keep the "no AI slop" promise.
import { cached, cacheKey } from "../cache";
import { llm, parseJSON, pdfPart } from "../llm/router";
import { fetchPdf, pdfPages } from "../sources/pdf";
import type { ScreenerCompany } from "../sources/screener";

export interface TranscriptRef {
  label: string; // Screener's month label, e.g. "Oct 2026"
  url: string;
  alts?: string[]; // other copies of the same call, tried in order if the first can't be read
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

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const labelTime = (l: string) => {
  const [m, y] = l.split(" ");
  return Number(y) * 12 + MON.indexOf(m);
};

/** The n most recent distinct transcripts. Screener's list can contain duplicates and stray old links. */
export function pickTranscripts(sc: ScreenerCompany, n = 4, extra: TranscriptRef[] = []): TranscriptRef[] {
  // Candidates, best first: Screener's exchange links, Screener's company links, then our own BSE
  // lookups (which are sometimes just a cover letter pointing at the company's website).
  const rank = (t: TranscriptRef, fromScreener: boolean) => (fromScreener ? (/bseindia/.test(t.url) ? 0 : 1) : 2);
  const seen = new Set<string>();
  const all: { t: TranscriptRef; r: number }[] = [];
  for (const c of sc.concalls) {
    if (!c.transcript || seen.has(c.transcript)) continue;
    seen.add(c.transcript);
    const t = { label: c.label, url: c.transcript };
    all.push({ t, r: rank(t, true) });
  }
  for (const t of extra) if (!seen.has(t.url)) all.push({ t, r: rank(t, false) });
  // One group per call: copies within a month of each other are the same call.
  const groups: { time: number; items: { t: TranscriptRef; r: number }[] }[] = [];
  for (const x of all.sort((p, q) => p.r - q.r)) {
    const time = labelTime(x.t.label);
    const g = groups.find((g) => Math.abs(g.time - time) <= 1);
    if (g) g.items.push(x);
    else groups.push({ time, items: [x] });
  }
  return groups
    .sort((a, b) => b.time - a.time)
    .slice(0, n)
    .map((g) => ({ label: g.items[0].t.label, url: g.items[0].t.url, alts: g.items.slice(1).map((x) => x.t.url) }));
}

/**
 * Page texts for a PDF, cached forever (re-used by extraction, quote checks and the Ask box).
 * Some companies file scanned transcripts with no text layer; those are transcribed once by the
 * cheap model (it reads PDFs natively), so quote verification and Ask keep working.
 */
export async function transcriptPages(url: string): Promise<string[]> {
  const { value } = await cached("pages", cacheKey("pages-v2", url), async () => {
    const bytes = await fetchPdf(url);
    const pages = await pdfPages(bytes);
    const chars = pages.reduce((n, p) => n + p.length, 0);
    if (chars > 300 * Math.max(1, pages.length)) return pages;
    const r = await llm({
      tier: "bulk",
      parts: [
        {
          text: "This is a scanned earnings-call transcript. Transcribe it faithfully, page by page. Start each page with a line '=== PAGE n ===' (n = page number). Keep speaker names. Do not summarise or skip anything.",
        },
        pdfPart(bytes),
      ],
      cacheId: `ocr-v1|${url}`,
      maxOutputTokens: 60000,
    });
    const parts = r.text.split(/^=== PAGE (\d+) ===\s*$/m);
    const out: string[] = [];
    for (let i = 1; i < parts.length; i += 2) out[Number(parts[i]) - 1] = parts[i + 1].trim();
    const filled = Array.from({ length: Math.max(out.length, pages.length) }, (_, i) => out[i] || pages[i] || "");
    return filled.some((p) => p.length > 200) ? filled : pages;
  });
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

/** A one-page letter saying "the transcript has been uploaded on our website" is not a transcript. */
function isCoverLetter(pages: string[]) {
  const text = pages.join(" ");
  return pages.length <= 3 && text.length < 6000 && /(uploaded|available|hosted|placed) (on|at) the (company'?s?|company’s)? ?website|below link|following link/i.test(text);
}

export async function extractCall(t: TranscriptRef, withBusiness = false): Promise<CallExtract> {
  let pages: string[] = [];
  let used = t.url;
  const reasons: string[] = [];
  for (const u of [t.url, ...(t.alts || [])]) {
    try {
      const p = await transcriptPages(u);
      if (isCoverLetter(p)) {
        reasons.push("exchange filing is only a cover letter");
        continue;
      }
      pages = p;
      used = u;
      break;
    } catch (e) {
      reasons.push(/Not a PDF/.test((e as Error).message) ? "company link is dead" : "couldn't download");
    }
  }
  if (!pages.length) throw new Error(`No readable transcript for ${t.label}: ${[...new Set(reasons)].join(", ")}`);
  t = { ...t, url: used };
  const body = pages.map((p, i) => `[[p.${i + 1}]]\n${p}`).join("\n\n").slice(0, 180_000);
  const r = await llm({
    tier: "bulk",
    parts: [{ text: EXTRACT_PROMPT(withBusiness) }, { text: body }],
    json: true,
    // Keyed by the text actually read, so a transcript that was re-read (e.g. after OCR) is re-extracted.
    cacheId: `call-v3|${withBusiness ? "b" : ""}|${t.url}|${cacheKey(body)}`,
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

/**
 * Transcripts the company filed on BSE (SEBI requires filing within five working days of the call).
 * Screener often links to a company's own IR host instead, and some of those (e.g. Azure blob
 * storage) refuse cloud servers, so the exchange copy is the reliable fallback for the same month.
 */
export async function bseTranscripts(scrip: number | null): Promise<TranscriptRef[]> {
  if (!scrip) return [];
  const { fetchAnnouncements, pdfUrl } = await import("../sources/bse");
  const since = new Date(Date.now() - 360 * 86400e3); // BSE returns nothing for ranges over a year
  const anns = await fetchAnnouncements(scrip, since).catch(() => []);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return anns
    .filter((a) => /transcript/i.test(`${a.NEWSSUB} ${a.SUBCATNAME} ${a.HEADLINE}`) && a.ATTACHMENTNAME)
    .map((a) => {
      // Filed up to five working days after the call: date it back a week so it lines up with Screener's month.
      const d = new Date(new Date(a.NEWS_DT).getTime() - 7 * 86400e3);
      return { label: `${MON[d.getMonth()]} ${d.getFullYear()}`, url: pdfUrl(a)! };
    });
}
