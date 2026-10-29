// Stage 2 of the push funnel: only filings that survived scoring get model time.
//   results            -> line items from the actual results PDF (cheap model, schema-enforced),
//                         maths done in code, validated against Screener; escalates to the
//                         stronger model only when validation fails
//   management_change  -> who changed and whether they are top management (cheap model on the
//                         filing), then background via grounded search only for senior appointees
//   everything else    -> "second opinion": the cheap model reads the filing PDF, writes one line
//                         of substance and nudges the rules' score within a bounded range
import { getJSON } from "../util/http";
import { webSearch } from "../sources/websearch";
import type { Category, Filing, MgmtCard, PersonBio, ResultsCard, SummaryCard, Triplet } from "../types";
import { llm, parseJSON, pdfPart, type LLMTier, type Part } from "../llm/router";
import { fetchPdf } from "../sources/pdf";
import type { ScreenerCompany } from "../sources/screener";
import { row } from "../sources/screener";
import { BASE_SCORE, tierOf } from "./classify";

// ---------- helpers ----------

/** Models sometimes return "1,234.5" or "(12.3)" as strings; normalise to numbers. */
export function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim();
  const neg = /^\(.*\)$/.test(s) || /^[-−–]/.test(s);
  s = s.replace(/[(),\s₹]/g, "").replace(/^[-−–]/, "");
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const S = {
  num: { type: "NUMBER", nullable: true },
  str: { type: "STRING" },
  strN: { type: "STRING", nullable: true },
  bool: { type: "BOOLEAN" },
};

// ---------- results ----------

const LINE_ITEMS = [
  "revenue_from_operations",
  "total_income",
  "other_income",
  "total_expenses",
  "finance_costs",
  "depreciation",
  "exceptional_items",
  "pbt",
  "pat",
  "operating_profit_before_provisions",
  "provisions",
] as const;
type LineItems = Partial<Record<(typeof LINE_ITEMS)[number], number | null>>;

const columnSchema = { type: "OBJECT", properties: Object.fromEntries(LINE_ITEMS.map((k) => [k, S.num])) };
const RESULTS_SCHEMA = {
  type: "OBJECT",
  properties: {
    found: S.bool,
    basis: { type: "STRING", enum: ["consolidated", "standalone"] },
    unit: { type: "STRING", enum: ["crore", "lakh", "million", "thousand", "rupees"] },
    is_lender: S.bool,
    current_period_end: { type: "STRING", description: "End date of the current quarter, YYYY-MM-DD" },
    current: columnSchema,
    previous_quarter: columnSchema,
    year_ago_quarter: columnSchema,
  },
  required: ["found", "basis", "unit", "is_lender", "current_period_end", "current", "previous_quarter", "year_ago_quarter"],
};

interface ResultsExtract {
  found: boolean;
  basis: "consolidated" | "standalone";
  unit: "crore" | "lakh" | "million" | "thousand" | "rupees";
  is_lender: boolean;
  current_period_end: string;
  current: LineItems;
  previous_quarter: LineItems;
  year_ago_quarter: LineItems;
}

const RESULTS_PROMPT = `You are reading an Indian listed company's quarterly financial results filing (SEBI LODR format).
Extract line items for exactly three columns of the QUARTERLY results table: the current quarter, the immediately preceding quarter, and the same quarter of the previous year. Ignore half-year and full-year columns.
Rules:
- Prefer the CONSOLIDATED statement if the filing has one; otherwise STANDALONE. Report which in "basis".
- Copy numbers exactly as printed, in the unit printed in that table's header (report it in "unit"). Do not convert.
- Negative values / losses must be negative numbers. Use null when a line is absent. Never estimate.
- total_expenses = the "Total expenses" line. pbt = profit before tax AFTER exceptional items. pat = total profit for the period (before splitting to owners / non-controlling interest).
- exceptional_items as printed (negative if a charge).
- Banks/NBFCs/insurers: is_lender=true; revenue_from_operations = total revenue from operations (or interest earned + other operating income); fill operating_profit_before_provisions and provisions when printed.
- If the document has no quarterly results table (a notice, a press release, a newspaper ad), set found=false.`;

const UNIT_TO_CRORE: Record<string, number> = { crore: 1, lakh: 0.01, million: 0.1, thousand: 0.0001, rupees: 1e-7 };

function ebitdaOf(li: LineItems, lender: boolean): number | null {
  const n = (k: (typeof LINE_ITEMS)[number]) => toNum(li[k]);
  if (lender) {
    if (n("operating_profit_before_provisions") != null) return n("operating_profit_before_provisions");
    if (n("pbt") != null && n("provisions") != null) return n("pbt")! + n("provisions")! - (n("exceptional_items") ?? 0);
    return null;
  }
  // EBITDA = revenue from operations - operating costs (total expenses less finance cost and D&A).
  // Computed here, never by the model, so the number is auditable.
  if (n("revenue_from_operations") != null && n("total_expenses") != null)
    return n("revenue_from_operations")! - (n("total_expenses")! - (n("finance_costs") ?? 0) - (n("depreciation") ?? 0));
  if (n("pbt") != null && n("finance_costs") != null && n("depreciation") != null)
    return n("pbt")! + n("finance_costs")! + n("depreciation")! - (n("other_income") ?? 0) - (n("exceptional_items") ?? 0);
  return null;
}

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  if (b < 0 && a > 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

function verdictLine(c: Omit<ResultsCard, "verdict" | "kind">): string {
  const f = (x: number | null) => (x == null ? null : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`);
  const parts: string[] = [];
  const revY = f(pct(c.revenue.cur, c.revenue.prevY));
  if (revY) parts.push(`Revenue ${revY} YoY`);
  const mNow = c.revenue.cur && c.ebitda.cur != null ? (c.ebitda.cur / c.revenue.cur) * 100 : null;
  const mThen = c.revenue.prevY && c.ebitda.prevY != null ? (c.ebitda.prevY / c.revenue.prevY) * 100 : null;
  if (mNow != null && mThen != null && !c.isLender) {
    const bps = Math.round((mNow - mThen) * 100);
    parts.push(`margin ${mNow.toFixed(1)}% (${bps >= 0 ? "+" : "−"}${Math.abs(bps)} bps)`);
  }
  if (c.pat.cur != null && c.pat.prevY != null && c.pat.prevY < 0 && c.pat.cur > 0) parts.push("PAT turned positive");
  else if (c.pat.cur != null && c.pat.cur < 0) parts.push("net loss");
  else if (f(pct(c.pat.cur, c.pat.prevY))) parts.push(`PAT ${f(pct(c.pat.cur, c.pat.prevY))} YoY`);
  return parts.join(", ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function quarterLabel(end: string): string | null {
  const m = end.match(/(20\d\d)-(\d\d)-\d\d/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const m2 = end.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-.,]*(\d{1,2}[\s,]*)?(20\d\d)/i);
  if (m2) return `${m2[1][0].toUpperCase()}${m2[1].slice(1, 3).toLowerCase()} ${m2[3]}`;
  return null;
}

export function fiscalLabel(q: string): string {
  const [mon, yr] = q.split(" ");
  const qn = ({ Jun: 1, Sep: 2, Dec: 3, Mar: 4 } as Record<string, number>)[mon];
  if (!qn) return q;
  const fy = mon === "Mar" ? Number(yr) : Number(yr) + 1;
  return `Q${qn} FY${String(fy).slice(2)} (${q})`;
}

function cardFrom(x: ResultsExtract, sc?: ScreenerCompany | null): ResultsCard | null {
  if (!x?.found || !x.current) return null;
  const k = UNIT_TO_CRORE[x.unit] ?? 1;
  const lender = Boolean(x.is_lender || sc?.isLender);
  const sc_ = (v: number | null) => (v == null ? null : r1(v * k));
  const trip = (f: (li: LineItems) => number | null): Triplet => ({
    cur: sc_(f(x.current || {})),
    prevQ: sc_(f(x.previous_quarter || {})),
    prevY: sc_(f(x.year_ago_quarter || {})),
  });
  const rev = (li: LineItems) => toNum(li.revenue_from_operations) ?? toNum(li.total_income);
  const q = quarterLabel(x.current_period_end || "");
  const exc = toNum(x.current.exceptional_items);
  const pbtNow = toNum(x.current.pbt);
  const base = {
    period: q ? fiscalLabel(q) : x.current_period_end,
    basis: x.basis,
    isLender: lender,
    revenue: trip(rev),
    ebitda: trip((li) => ebitdaOf(li, lender)),
    pbt: trip((li) => toNum(li.pbt)),
    pat: trip((li) => toNum(li.pat)),
    ebitdaLabel: lender ? "Pre-provision profit" : "EBITDA",
    exceptional:
      exc && pbtNow && Math.abs(exc) > 0.05 * Math.abs(pbtNow)
        ? `Exceptional item of ₹${Math.abs(exc * k).toLocaleString("en-IN", { maximumFractionDigits: 0 })} cr ${exc < 0 ? "hit" : "lifted"} PBT`
        : null,
  };
  const card: ResultsCard = { kind: "results", ...base, verdict: verdictLine(base) };
  if (sc && q) {
    const i = sc.quarters.cols.indexOf(q);
    if (i >= 0) {
      const sSales = row(sc.quarters, "Sales", "Revenue")[i];
      const sPat = row(sc.quarters, "Net Profit")[i];
      const near = (a: number | null, b: number | null, tol: number) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
      const sameBasis = sc.basis === x.basis;
      const ok = near(card.revenue.cur, sSales, 0.03) && near(card.pat.cur, sPat, 0.05);
      card.check = {
        source: "screener",
        agrees: ok || !sameBasis,
        note: ok
          ? "Revenue and PAT match Screener's table"
          : !sameBasis
            ? `Read from the ${x.basis} statement (Screener tracks ${sc.basis})`
            : `Screener shows revenue ${sSales ?? "–"} / PAT ${sPat ?? "–"} cr`,
      };
    }
  }
  return card;
}

const usable = (c: ResultsCard | null) => Boolean(c && c.revenue.cur != null && c.pat.cur != null && (!c.check || c.check.agrees));

/** Results card from the filing PDF: cheap model first, stronger model only if validation fails. */
export async function enrichResults(pdfUrl: string, sc?: ScreenerCompany | null): Promise<ResultsCard | null> {
  const bytes = await fetchPdf(pdfUrl);
  let best: ResultsCard | null = null;
  for (const tier of ["bulk", "reason"] as LLMTier[]) {
    const res = await llm({
      tier,
      parts: [{ text: RESULTS_PROMPT }, pdfPart(bytes)],
      json: true,
      schema: RESULTS_SCHEMA,
      cacheId: `results-v3|${pdfUrl}`,
      maxOutputTokens: 3000,
    });
    const card = cardFrom(parseJSON<ResultsExtract>(res.text), sc);
    if (card) card.extractedBy = res.model;
    if (usable(card)) return card;
    if (card && (!best || (best.revenue.cur == null && card.revenue.cur != null))) best = card;
  }
  return best;
}

/** Last resort when the filing can't be parsed: Screener's table, clearly labelled. */
export function resultsFromScreener(sc: ScreenerCompany, filedAt?: string): ResultsCard | null {
  const n = sc.quarters.cols.length;
  if (n < 5) return null;
  // Only if Screener's latest quarter is the one this filing is about (filed within ~75 days of quarter end).
  if (filedAt) {
    const [mon, yr] = sc.quarters.cols[n - 1].split(" ");
    const qEnd = new Date(Date.UTC(Number(yr), MONTHS.indexOf(mon) + 1, 0));
    const lag = (new Date(filedAt).getTime() - qEnd.getTime()) / 86400e3;
    if (lag < 0 || lag > 75) return null;
  }
  const pick = (vals: (number | null)[]): Triplet => ({ cur: vals[n - 1], prevQ: vals[n - 2], prevY: vals[n - 5] });
  const base = {
    period: fiscalLabel(sc.quarters.cols[n - 1]),
    basis: sc.basis,
    isLender: sc.isLender,
    revenue: pick(row(sc.quarters, "Sales", "Revenue")),
    ebitda: pick(row(sc.quarters, "Operating Profit", "Financing Profit")),
    pbt: pick(row(sc.quarters, "Profit before tax")),
    pat: pick(row(sc.quarters, "Net Profit")),
    ebitdaLabel: sc.isLender ? "Financing profit" : "Operating profit",
    exceptional: null,
  };
  return { kind: "results", ...base, verdict: verdictLine(base), check: { source: "screener", agrees: true, note: "Filing could not be parsed; numbers from Screener's table" } };
}

// ---------- management change ----------

const MGMT_SCHEMA = {
  type: "OBJECT",
  properties: {
    people: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: S.str,
          role: S.str,
          change: { type: "STRING", enum: ["appointed", "resigned", "retired", "redesignated", "other"] },
          senior: { type: "BOOLEAN", description: "true for MD, CEO, CFO, COO, Chairperson, Whole-time/Executive Director, or business/division head" },
          effective: S.strN,
          profile_in_filing: S.strN,
        },
        required: ["name", "role", "change", "senior"],
      },
    },
    reason: S.strN,
  },
  required: ["people"],
};

const MGMT_PROMPT = `This is an Indian stock-exchange filing about a change in directors or management.
List each person whose position changes: full name without honorifics, role, change type, whether the role is senior (see schema), effective date if stated, and profile_in_filing = one sentence on any background the filing itself gives (null if none). "reason" = the stated reason for any resignation (short), else null. Ignore people whose role does not change.`;

export async function enrichManagement(f: Filing): Promise<{ card: MgmtCard; senior: boolean } | null> {
  const parts: Part[] = [{ text: MGMT_PROMPT }, { text: `Subject: ${f.title}\nSummary: ${f.headline}` }];
  if (f.pdf) {
    try {
      parts.push(pdfPart(await fetchPdf(f.pdf)));
    } catch {
      /* headline-only still works */
    }
  }
  const ex = parseJSON<{ people: (PersonBio & { senior: boolean; profile_in_filing?: string | null })[]; reason?: string | null }>(
    (await llm({ tier: "bulk", parts, json: true, schema: MGMT_SCHEMA, cacheId: `mgmt-v2|${f.id}`, maxOutputTokens: 1200 })).text,
  );
  if (!ex.people?.length) return null;
  const senior = ex.people.some((p) => p.senior);
  const people: PersonBio[] = [];
  for (const p of ex.people.slice(0, 4)) {
    const person: PersonBio = { name: p.name, role: p.role, change: p.change, effective: p.effective ?? null, bio: p.profile_in_filing ?? null };
    if (p.senior && (p.change === "appointed" || p.change === "redesignated")) {
      try {
        const r = await llm({
          tier: "search",
          parts: [
            {
              text: `A management change was announced at ${f.company} (India): ${p.name} is ${p.change} as ${p.role}.
Use web search (LinkedIn, the company's site, earlier press releases) to write a concise professional bio of this specific person.
Rules: at most 2 sentences, 35 words. Lead with their immediate previous role and employer, then the major companies or functions behind them and any pedigree that matters for this role. No generic praise ("seasoned", "visionary", "dynamic"). If you cannot find this exact person, say so with null.
Reply with JSON only: {"bio": "..." or null, "previously": ["<Role, Company, years if known>", ...up to 3, most recent first]}.`,
            },
          ],
          cacheId: `bio-v4|${p.name}|${f.company}`,
          maxOutputTokens: 700,
        });
        const b = parseJSON<{ bio: string | null; previously: string[] }>(r.text);
        if (b.bio) person.bio = b.bio;
        person.previously = (b.previously || []).slice(0, 3);
        person.sources = (r.sources || []).slice(0, 3);
      } catch (e) {
        console.error("bio search failed:", (e as Error).message.slice(0, 160));
      }
      // No grounded-search quota left, or nothing found: a plain web search, then Wikipedia.
      if (!person.sources?.length) {
        const w = (await webBio(p.name, p.role, f.company).catch(() => null)) ?? (await wikiBio(p.name, f.company).catch(() => null));
        if (w) Object.assign(person, w);
      }
    }
    people.push(person);
  }
  // Lead with the incoming person: "who is taking over" is the question.
  const order = { appointed: 0, redesignated: 1, resigned: 2, retired: 3, other: 4 } as const;
  people.sort((a, b) => order[a.change] - order[b.change]);
  return { card: { kind: "management", people, reason: ex.reason ?? null }, senior };
}

/**
 * Fallback bio from a plain web search: the cheap model writes it from the result snippets only,
 * and only snippets that name both the person and the company count, so a namesake can't slip in.
 */
async function webBio(name: string, role: string, company: string): Promise<Pick<PersonBio, "bio" | "previously" | "sources"> | null> {
  const firm = company.replace(/\b(Ltd|Limited)\.?$/i, "").trim();
  const hits = await webSearch(`"${name}" ${firm} ${role}`);
  const surname = name.trim().split(/\s+/).at(-1)!.toLowerCase();
  const firmWord = firm.split(/\s+/)[0].toLowerCase();
  const good = hits.filter((h) => `${h.title} ${h.snippet}`.toLowerCase().includes(surname));
  if (!good.length || !good.some((h) => `${h.title} ${h.snippet} ${h.url}`.toLowerCase().includes(firmWord))) return null;
  const r = await llm({
    tier: "bulk",
    parts: [
      {
        text: `${name} has been ${role.toLowerCase().includes("director") ? "named" : "appointed"} ${role} at ${company}. From these web search results ONLY, write a professional bio. At most 2 sentences, 35 words. Lead with the immediate previous role and employer, then the major companies behind them. No praise words. If the results don't describe this person's career, return null.
Reply JSON: {"bio": "..." or null, "previously": ["<Role, Company, years if known>", ...up to 3, most recent first], "used": [indexes of the results you relied on]}

${good.map((h, i) => `[${i}] ${h.title}\n${h.snippet}`).join("\n\n")}`,
      },
    ],
    json: true,
    cacheId: `webbio-v1|${name}|${company}|${good.map((h) => h.url).join(",")}`,
    maxOutputTokens: 500,
  });
  const b = parseJSON<{ bio: string | null; previously?: string[]; used?: number[] }>(r.text);
  if (!b.bio) return null;
  const used = (b.used || []).map((i) => good[i]).filter(Boolean);
  const src = (used.length ? used : good).slice(0, 3).map((h) => ({ title: new URL(h.url).hostname.replace(/^www\./, ""), url: h.url }));
  return { bio: b.bio, previously: (b.previously || []).slice(0, 3), sources: src };
}

/**
 * Fallback bio from Wikipedia: find the person's article (the company name must appear in it, so
 * a namesake is never used), then let the cheap model compress it to the same two-sentence format.
 */
async function wikiBio(name: string, company: string): Promise<Pick<PersonBio, "bio" | "previously" | "sources"> | null> {
  const api = "https://en.wikipedia.org/w/api.php?format=json&origin=*&action=query";
  const q = await getJSON<{ query: { search: { title: string }[] } }>(`${api}&list=search&srlimit=3&srsearch=${encodeURIComponent(`${name} ${company.replace(/\b(Ltd|Limited)\.?$/i, "")}`)}`);
  const surname = name.trim().split(/\s+/).at(-1)!.toLowerCase();
  const firm = company.split(/\s+/)[0].toLowerCase();
  for (const hit of q.query.search) {
    if (!hit.title.toLowerCase().includes(surname)) continue;
    const page = await getJSON<{ query: { pages: Record<string, { extract?: string; fullurl?: string }> } }>(
      `${api}&prop=extracts|info&inprop=url&explaintext=1&exchars=3500&titles=${encodeURIComponent(hit.title)}`,
    );
    const pg = Object.values(page.query.pages)[0];
    const text = pg?.extract || "";
    if (!text.toLowerCase().includes(firm) || text.length < 200) continue;
    const r = await llm({
      tier: "bulk",
      parts: [
        {
          text: `From this Wikipedia text only, write a professional bio of ${name}, newly ${company}'s executive. At most 2 sentences, 35 words. Lead with the immediate previous role and employer, then the major companies behind them. No praise words.
Reply JSON: {"bio": "...", "previously": ["<Role, Company, years if known>", ...up to 3, most recent first]}

${text}`,
        },
      ],
      json: true,
      cacheId: `wikibio-v1|${name}|${hit.title}`,
      maxOutputTokens: 500,
    });
    const b = parseJSON<{ bio: string | null; previously?: string[] }>(r.text);
    if (!b.bio) continue;
    return { bio: b.bio, previously: (b.previously || []).slice(0, 3), sources: [{ title: `Wikipedia: ${hit.title}`, url: pg.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}` }] };
  }
  return null;
}

// ---------- second opinion on everything else that might matter ----------

const CATS = Object.keys(BASE_SCORE) as Category[];
const OPINION_SCHEMA = {
  type: "OBJECT",
  properties: {
    category: { type: "STRING", enum: CATS },
    materiality: { type: "INTEGER", description: "0-100: how likely this moves the stock or changes the investment case" },
    line: { type: "STRING", nullable: true, description: "<=20 words, the concrete fact (amounts, counterparties, dates). null if the filing has no substance beyond its title." },
  },
  required: ["category", "materiality", "line"],
};

const OPINION_PROMPT = (f: Filing) => `You are a ruthless equity research analyst triaging stock-exchange filings for a portfolio manager who owns ${f.company} (${f.ticker}). Your job is to filter noise, not to summarise.
Read the filing and return: category, materiality (0-100; results/large M&A/CEO exit ~85+, routine compliance <15) and "line": the single most decision-relevant fact in at most 20 words, with numbers.
The attached PDF is often a board-meeting outcome that bundles several decisions (results, dividends, subsidiaries, appointments). Judge and summarise ONLY the decision this filing's subject refers to; the others are filed and scored separately. Setting up or closing a small subsidiary is not material M&A. No filler like "the company announced"; start with the fact. If there is nothing beyond the title, line = null.
Exchange subject: ${f.title}
Company's gist: ${f.headline.slice(0, 600)}`;

export async function secondOpinion(f: Filing): Promise<{ category: Category; materiality: number; line: string | null } | null> {
  const parts: Part[] = [{ text: OPINION_PROMPT(f) }];
  let withPdf = false;
  if (f.pdf) {
    try {
      const b = await fetchPdf(f.pdf);
      if (b.length < 6_000_000) {
        parts.push(pdfPart(b));
        withPdf = true;
      }
    } catch {
      /* fall back to text */
    }
  }
  const r = await llm({ tier: "bulk", parts, json: true, schema: OPINION_SCHEMA, cacheId: `opinion-v2-1|${withPdf ? "pdf" : "txt"}|${f.id}`, maxOutputTokens: 400 });
  const o = parseJSON<{ category: Category; materiality: number; line: string | null }>(r.text);
  if (!CATS.includes(o.category)) return null;
  return { ...o, materiality: Math.max(0, Math.min(100, Math.round(toNum(o.materiality) ?? 0))) };
}

/** Fuse rule score and model score. Rules anchor; the model can move a rule's score by at most ±25. */
export function fuse(f: Filing, o: { category: Category; materiality: number; line: string | null }) {
  if (f.classifiedBy === "llm") {
    f.category = o.category;
    f.score = o.materiality;
    f.reason = `No rule matched; the model read the filing and scored it ${o.materiality}`;
  } else {
    const s = Math.round(Math.max(f.score - 25, Math.min(f.score + 25, (f.score + o.materiality) / 2)));
    if (s !== f.score) f.reason = `${f.reason}. Rules said ${f.score}, the model read the filing and said ${o.materiality}`;
    f.score = s;
  }
  f.tier = tierOf(f.score);
  // A line about the quarter's results on a filing that isn't about results is the model reading the
  // wrong part of a bundled PDF: drop it rather than mislead.
  if (o.line && !(f.category !== "results" && /financial results|un-?audited|quarter (and half year )?ended/i.test(o.line))) f.enrichment = summaryCard(o.line);
}

export function summaryCard(line: string): SummaryCard {
  return { kind: "summary", line };
}
