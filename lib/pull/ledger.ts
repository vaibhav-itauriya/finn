// Reduce step: the one place we pay for a stronger model.
// Input is already compact (structured guidance from 4 calls + the reported quarterly table),
// so the reasoning model sees maybe 4-6k tokens instead of 150k of raw transcripts.
import { llm, parseJSON } from "../llm/router";
import { cacheKey } from "../cache";
import type { CallExtract } from "./calls";
import type { NumbersView } from "./numbers";

export type Outcome = "delivered" | "missed" | "partly" | "pending" | "dropped";

export interface Cite {
  quarter?: string | null;
  page?: number | null;
  url?: string;
  quote?: string | null;
  table?: string | null; // evidence from the reported numbers rather than a document page
}

export interface LedgerRow {
  metric: string;
  promise: string;
  made: string; // quarter when promised
  horizon: string;
  outcome: Outcome;
  evidence: string;
  promiseCite: Cite;
  evidenceCite: Cite;
}

export interface Ledger {
  credibility: { score: number; line: string; delivered: number; missed: number; partly: number; pending: number; dropped: number };
  rows: LedgerRow[];
  divergences: { claim: string; reality: string; tone: "bad" | "watch" | "good"; cite: Cite }[];
  currentGuidance: { metric: string; statement: string; horizon: string; cite: Cite }[];
}

export interface Thesis {
  business: { summary: string; segments: { name: string; share: string | null; note: string }[]; cite: Cite } | null;
  bull: { point: string; cite: Cite }[];
  bear: { point: string; cite: Cite }[];
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
      return `### ${/annual report/.test(c.quarter) ? "Annual report" : "Call"}: ${c.quarter} (${c.callDate || "date n/a"})\nTone: ${c.tone}\nGuidance given:\n${g || "  (none)"}\nManagement says delivered:\n${d || "  (none)"}\nAnalyst pushback:\n${p || "  (none)"}`;
    })
    .join("\n\n");
}

const CITE = {
  type: "OBJECT",
  properties: {
    quarter: { type: "STRING", nullable: true },
    page: { type: "INTEGER", nullable: true },
    quote: { type: "STRING", nullable: true },
    table: { type: "STRING", nullable: true, description: "set instead of quarter/page when the evidence is the reported numbers table, e.g. 'Q2 FY27 reported'" },
  },
};
const COUNT = { type: "INTEGER" };
const LEDGER_SCHEMA = {
  type: "OBJECT",
  properties: {
    credibility: {
      type: "OBJECT",
      properties: { score: { type: "NUMBER" }, line: { type: "STRING" }, delivered: COUNT, missed: COUNT, partly: COUNT, pending: COUNT, dropped: COUNT },
      required: ["score", "line", "delivered", "missed", "partly", "pending", "dropped"],
    },
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          metric: { type: "STRING" },
          promise: { type: "STRING" },
          made: { type: "STRING" },
          horizon: { type: "STRING" },
          outcome: { type: "STRING", enum: ["delivered", "missed", "partly", "pending", "dropped"] },
          evidence: { type: "STRING" },
          promiseCite: CITE,
          evidenceCite: CITE,
        },
        required: ["metric", "promise", "made", "horizon", "outcome", "evidence", "promiseCite", "evidenceCite"],
      },
    },
    divergences: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { claim: { type: "STRING" }, reality: { type: "STRING" }, tone: { type: "STRING", enum: ["bad", "watch", "good"] }, cite: CITE },
        required: ["claim", "reality", "tone", "cite"],
      },
    },
    currentGuidance: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { metric: { type: "STRING" }, statement: { type: "STRING" }, horizon: { type: "STRING" }, cite: CITE },
        required: ["metric", "statement", "horizon", "cite"],
      },
    },
  },
  required: ["credibility", "rows", "divergences", "currentGuidance"],
};
const THESIS_SCHEMA = {
  type: "OBJECT",
  properties: {
    bull: { type: "ARRAY", items: { type: "OBJECT", properties: { point: { type: "STRING" }, cite: CITE }, required: ["point", "cite"] } },
    bear: { type: "ARRAY", items: { type: "OBJECT", properties: { point: { type: "STRING" }, cite: CITE }, required: ["point", "cite"] } },
    watch: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["bull", "bear", "watch"],
};

const LEDGER_PROMPT = `You are a sceptical buy-side analyst. Judge management's credibility using ONLY the material below: structured notes from their own earnings calls and/or annual reports (oldest first; an annual report's promises are judged against the years after it) and the company's reported quarterly numbers. No outside knowledge.

Tasks:
1. "rows": for each meaningful promise made in the OLDER calls, decide what happened by the latest data:
   - "delivered": numbers or later calls show it was met
   - "missed": the period has passed and it was not met
   - "partly": directionally right but short of the number
   - "pending": horizon not reached yet; say what the run-rate implies
   - "dropped": management stopped mentioning it or quietly changed the target (moved goalposts)
   Evidence must cite either the reported table (say which quarter and number) or a later call (quarter + page). Be specific with numbers. Max 8 rows, most important first. Skip trivial or unmeasurable promises.
   The promise must name the business or segment it is about (e.g. "Watches: EBIT margin back to 15-16%"). Evidence must be about the SAME metric and the SAME segment; if you have no such evidence, the outcome is "pending", never "delivered".
   For promiseCite.quote copy a quote exactly as given in the notes, or leave it null.
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
    schema: LEDGER_SCHEMA,
    cacheId: `ledger-v5|${numbers.header.ticker}|${cacheKey(JSON.stringify(calls.map((c) => [c.url, c.guidance, c.delivered])))}|${numbers.quarters.cols.at(-1)}`,
    maxOutputTokens: 8192,
  });
  const l = parseJSON<Ledger>(r.text);
  // Attach document links so every citation in the UI opens the source PDF.
  const urlOf = new Map(calls.map((c) => [c.quarter, c.url]));
  const link = <T,>(c: T): T => {
    const q = (c as { quarter?: string | null })?.quarter;
    return q && urlOf.get(q) ? { ...c, url: urlOf.get(q) } : c;
  };
  // Ground each promise in a quote we already string-matched against the transcript PDF:
  // pick the verified guidance item from that call that best overlaps the promise text.
  // The model's own quote is never shown unless it is one of those.
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9%]+/g, " ").split(" ").filter((w) => w.length > 2));
  const overlap = (a: Set<string>, b: Set<string>) => {
    let n = 0;
    a.forEach((w) => b.has(w) && n++);
    return n / Math.max(1, Math.min(a.size, b.size));
  };
  const ground = (row: LedgerRow): Cite => {
    const c = calls.find((x) => x.quarter === row.promiseCite?.quarter) ?? null;
    const pool = (c ? c.guidance : calls.flatMap((x) => x.guidance)).filter((g) => g.verified);
    const pw = words(row.promise);
    // If the promise has numbers, the quote must share at least one of them ("4500" won't match a "$1 billion" quote).
    const nums = (t: string) => new Set((t.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]$/, "").replace(/,/g, "")));
    const pn = nums(row.promise);
    let best: { g: (typeof pool)[number]; s: number } | null = null;
    for (const g of pool) {
      const gn = nums(`${g.statement} ${g.quote}`);
      if (pn.size && ![...pn].some((n) => gn.has(n))) continue;
      const sc = overlap(pw, words(`${g.statement} ${g.quote}`));
      if (!best || sc > best.s) best = { g, s: sc };
    }
    const owner = c ?? calls.find((x) => best && x.guidance.includes(best.g));
    if (best && best.s >= 0.3 && owner) return { quarter: owner.quarter, page: best.g.page, quote: best.g.quote, url: owner.url };
    return { ...row.promiseCite, quote: null };
  };
  l.rows = (l.rows || []).map((x) => ({ ...x, promiseCite: link(ground(x)), evidenceCite: link(x.evidenceCite) }));
  l.divergences = (l.divergences || []).map((d) => ({ ...d, cite: link(d.cite) }));
  l.currentGuidance = (l.currentGuidance || []).map((g) => ({ ...g, cite: link(g.cite) }));
  return l;
}

const THESIS_PROMPT = `Using ONLY the earnings-call or annual-report notes, the business description from the latest document and the computed financial signals below, write a tight bull and bear case for a portfolio manager. No outside knowledge, no news, no broker views.
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
    schema: THESIS_SCHEMA,
    cacheId: `thesis-v2|${numbers.header.ticker}|${cacheKey(JSON.stringify(calls.map((c) => [c.url, c.guidance, c.delivered])))}|${numbers.quarters.cols.at(-1)}`,
    maxOutputTokens: 4096,
  });
  const t = parseJSON<Omit<Thesis, "business">>(r.text);
  const urlOf = new Map(calls.map((c) => [c.quarter, c.url]));
  const link = <T,>(c: T): T => {
    const q = (c as { quarter?: string | null })?.quarter;
    return q && urlOf.get(q) ? { ...c, url: urlOf.get(q) } : c;
  };
  return {
    business: latest?.business ? { ...latest.business, cite: { quarter: latest.quarter, page: latest.business.page, url: latest.url } } : null,
    bull: (t.bull || []).map((b) => ({ ...b, cite: link(b.cite) })),
    bear: (t.bear || []).map((b) => ({ ...b, cite: link(b.cite) })),
    watch: t.watch || [],
  };
}
