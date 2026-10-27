// Reduce step: the one place we pay for a stronger model.
// Input is already compact (structured guidance from 4 calls + the reported quarterly table),
// so the reasoning model sees maybe 4-6k tokens instead of 150k of raw transcripts.
import { llm, parseJSON } from "../llm/router";
import type { CallExtract } from "./calls";
import type { NumbersView } from "./numbers";

export type Outcome = "delivered" | "missed" | "partly" | "pending" | "dropped";

export interface Cite {
  quarter: string;
  page?: number;
  url?: string;
  quote?: string;
}

export interface LedgerRow {
  metric: string;
  promise: string;
  made: string; // quarter when promised
  horizon: string;
  outcome: Outcome;
  evidence: string;
  promiseCite: Cite;
  evidenceCite: Cite | { table: string };
}

export interface Ledger {
  credibility: { score: number; line: string; delivered: number; missed: number; partly: number; pending: number; dropped: number };
  rows: LedgerRow[];
  divergences: { claim: string; reality: string; tone: "bad" | "watch" | "good"; cite: Cite }[];
  currentGuidance: { metric: string; statement: string; horizon: string; cite: Cite }[];
}

export interface Thesis {
  business: { summary: string; segments: { name: string; share: string | null; note: string }[]; cite: Cite } | null;
  bull: { point: string; cite: Cite | { table: string } }[];
  bear: { point: string; cite: Cite | { table: string } }[];
  watch: string[]; // what to check next quarter
}

function actualsTable(n: NumbersView): string {
  const q = n.quarters;
  const f = (x: number | null, d = 0) => (x == null ? "–" : x.toFixed(d));
  const lines = q.cols.map(
    (c, i) =>
      `${c}: revenue ${f(q.revenue[i])} cr (YoY ${f(q.revYoY[i], 1)}%), ${n.header.isLender ? "financing profit" : "EBITDA"} margin ${f(q.margin[i], 1)}%, PAT ${f(q.pat[i])} cr (YoY ${f(q.patYoY[i], 1)}%)`,
  );
  return `Reported quarterly numbers (₹ crore, ${n.header.basis}), from exchange filings via Screener:\n${lines.join("\n")}`;
}

function callsBlock(calls: CallExtract[]): string {
  return calls
    .map((c) => {
      const g = c.guidance.map((x) => `  - [${x.metric}] ${x.statement} (horizon: ${x.horizon}; p.${x.page}; quote: "${x.quote}"${x.verified ? "" : "; UNVERIFIED"})`).join("\n");
      const d = c.delivered.map((x) => `  - [${x.metric}] ${x.statement} (p.${x.page})`).join("\n");
      const p = c.pushback.map((x) => `  - ${x.topic}: ${x.gist} (p.${x.page})`).join("\n");
      return `### Call: ${c.quarter} (${c.callDate || "date n/a"})\nTone: ${c.tone}\nGuidance given:\n${g || "  (none)"}\nManagement says delivered:\n${d || "  (none)"}\nAnalyst pushback:\n${p || "  (none)"}`;
    })
    .join("\n\n");
}

const LEDGER_PROMPT = `You are a sceptical buy-side analyst. Judge management's credibility using ONLY the material below: structured notes from their own earnings calls (oldest first) and the company's reported quarterly numbers. No outside knowledge.

Tasks:
1. "rows": for each meaningful promise made in the OLDER calls, decide what happened by the latest data:
   - "delivered": numbers or later calls show it was met
   - "missed": the period has passed and it was not met
   - "partly": directionally right but short of the number
   - "pending": horizon not reached yet; say what the run-rate implies
   - "dropped": management stopped mentioning it or quietly changed the target (moved goalposts)
   Evidence must cite either the reported table (say which quarter and number) or a later call (quarter + page). Be specific with numbers. Max 8 rows, most important first. Skip trivial or unmeasurable promises.
2. "divergences": up to 4 places where the story and the numbers disagree (e.g. "demand is strong" while revenue growth decelerated 3 quarters in a row). Use "good" only when numbers beat the story.
3. "currentGuidance": what the LATEST call guides for, max 5 items.
4. "credibility": score 0-10 and one line (<=25 words) a PM can act on, plus counts.

Return JSON:
{"credibility":{"score":n,"line":"...","delivered":n,"missed":n,"partly":n,"pending":n,"dropped":n},
 "rows":[{"metric":"...","promise":"<=20 words","made":"Q? FY??","horizon":"...","outcome":"...","evidence":"<=30 words with numbers","promiseCite":{"quarter":"...","page":n,"quote":"verbatim quote from notes"},"evidenceCite":{"quarter":"...","page":n} or {"table":"Q? FY?? reported"}}],
 "divergences":[{"claim":"<=15 words","reality":"<=20 words with numbers","tone":"bad|watch|good","cite":{"quarter":"...","page":n}}],
 "currentGuidance":[{"metric":"...","statement":"<=20 words","horizon":"...","cite":{"quarter":"...","page":n}}]}
Write plainly. No hedging filler.`;

export async function buildLedger(calls: CallExtract[], numbers: NumbersView): Promise<Ledger> {
  const ordered = [...calls].reverse(); // oldest first
  const input = `${callsBlock(ordered)}\n\n${actualsTable(numbers)}`;
  const r = await llm({
    tier: "reason",
    parts: [{ text: LEDGER_PROMPT }, { text: input }],
    json: true,
    cacheId: `ledger-v2|${numbers.header.ticker}|${calls.map((c) => c.url).join(",")}|${numbers.quarters.cols.at(-1)}`,
    maxOutputTokens: 8192,
  });
  const l = parseJSON<Ledger>(r.text);
  // Attach document links so every citation in the UI opens the source PDF.
  const urlOf = new Map(calls.map((c) => [c.quarter, c.url]));
  const link = (c: Cite) => (c && "quarter" in c ? { ...c, url: urlOf.get(c.quarter) } : c);
  l.rows = (l.rows || []).map((x) => ({ ...x, promiseCite: link(x.promiseCite), evidenceCite: "quarter" in (x.evidenceCite || {}) ? link(x.evidenceCite as Cite) : x.evidenceCite }));
  l.divergences = (l.divergences || []).map((d) => ({ ...d, cite: link(d.cite) }));
  l.currentGuidance = (l.currentGuidance || []).map((g) => ({ ...g, cite: link(g.cite) }));
  return l;
}

const THESIS_PROMPT = `Using ONLY the earnings-call notes, the business description from the latest call and the computed financial signals below, write a tight bull and bear case for a portfolio manager. No outside knowledge, no news, no broker views.
Each point <=22 words, concrete, with a number where possible, and a citation: {"quarter":"...","page":n} for call material or {"table":"<which signal>"} for computed financials. 3-4 points each side. Then "watch": 3 specific things to check in the next results (<=15 words each).
Return JSON {"bull":[{"point":"...","cite":{...}}],"bear":[...],"watch":["..."]}.`;

export async function buildThesis(calls: CallExtract[], numbers: NumbersView): Promise<Thesis> {
  const latest = calls[0];
  const signals = [...numbers.trajectory.signals, ...numbers.balance.signals, ...numbers.cash.signals].map((s) => `- (${s.tone}) ${s.text}`).join("\n");
  const biz = latest?.business ? `Business (from ${latest.quarter} call p.${latest.business.page}): ${latest.business.summary}\nSegments: ${latest.business.segments.map((s) => `${s.name}${s.share ? ` (${s.share})` : ""}: ${s.note}`).join("; ")}` : "";
  const r = await llm({
    tier: "reason",
    parts: [{ text: THESIS_PROMPT }, { text: `${biz}\n\nComputed financial signals:\n${signals}\n\n${actualsTable(numbers)}\n\n${callsBlock([...calls].reverse())}` }],
    json: true,
    cacheId: `thesis-v1|${numbers.header.ticker}|${calls.map((c) => c.url).join(",")}|${numbers.quarters.cols.at(-1)}`,
    maxOutputTokens: 4096,
  });
  const t = parseJSON<Omit<Thesis, "business">>(r.text);
  const urlOf = new Map(calls.map((c) => [c.quarter, c.url]));
  const link = (c: Cite | { table: string }) => (c && "quarter" in c ? { ...c, url: urlOf.get(c.quarter) } : c);
  return {
    business: latest?.business ? { ...latest.business, cite: { quarter: latest.quarter, page: latest.business.page, url: latest.url } } : null,
    bull: (t.bull || []).map((b) => ({ ...b, cite: link(b.cite) })),
    bear: (t.bear || []).map((b) => ({ ...b, cite: link(b.cite) })),
    watch: t.watch || [],
  };
}
