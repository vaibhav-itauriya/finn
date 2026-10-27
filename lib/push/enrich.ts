// Stage 2 of the push funnel: only filings that survived scoring get model time.
//   results            -> line items from the actual results PDF (bulk model), maths done in code,
//                         cross-checked against Screener's table
//   management_change  -> who changed (bulk model on the filing) + background (grounded search)
//   other material     -> one line on why it matters (bulk model)
import type { Category, Filing, MgmtCard, PersonBio, ResultsCard, SummaryCard, Triplet } from "../types";
import { llm, parseJSON, pdfPart } from "../llm/router";
import { fetchPdf } from "../sources/pdf";
import type { ScreenerCompany } from "../sources/screener";
import { row } from "../sources/screener";
import { BASE_SCORE } from "./classify";

// ---------- results ----------

interface LineItems {
  revenue_from_operations?: number | null;
  total_income?: number | null;
  other_income?: number | null;
  total_expenses?: number | null;
  finance_costs?: number | null;
  depreciation?: number | null;
  exceptional_items?: number | null; // as reported: negative = loss
  pbt?: number | null;
  pat?: number | null;
  operating_profit_before_provisions?: number | null; // lenders
  provisions?: number | null; // lenders
}

interface ResultsExtract {
  found: boolean;
  basis: "consolidated" | "standalone";
  unit: "crore" | "lakh" | "million" | "thousand" | "rupees";
  is_lender: boolean;
  current_period: string; // "Quarter ended 30-Sep-2026"
  current: LineItems;
  previous_quarter: LineItems;
  year_ago_quarter: LineItems;
}

const RESULTS_PROMPT = `You are reading an Indian listed company's quarterly financial results filing (SEBI LODR format).
Extract line items for exactly three columns of the QUARTERLY table: the current quarter, the immediately preceding quarter, and the corresponding quarter of the previous year.
Rules:
- Prefer the CONSOLIDATED results if present; otherwise use STANDALONE. Say which in "basis".
- Copy numbers exactly as printed, in the unit printed in the table header (state it in "unit"). Do not convert.
- Losses and negative values must be negative numbers. Use null when a line is not present. Never guess.
- "pat" = profit for the period (before minority interest split, i.e. the total). "pbt" = profit before tax AFTER exceptional items.
- "exceptional_items": as printed, negative if it is a loss/charge.
- Banks/NBFCs/insurers: set is_lender=true, put interest earned / total revenue from operations in revenue_from_operations and fill operating_profit_before_provisions and provisions if printed.
- If this document has no quarterly results table (e.g. it is only a notice or press release), return {"found": false}.
Return JSON with keys: found, basis, unit, is_lender, current_period, current, previous_quarter, year_ago_quarter. Each column has keys: revenue_from_operations, total_income, other_income, total_expenses, finance_costs, depreciation, exceptional_items, pbt, pat, operating_profit_before_provisions, provisions.`;

const UNIT_TO_CRORE: Record<string, number> = { crore: 1, lakh: 0.01, million: 0.1, thousand: 0.0001, rupees: 1e-7 };

function ebitdaOf(li: LineItems, lender: boolean): number | null {
  if (lender) {
    if (li.operating_profit_before_provisions != null) return li.operating_profit_before_provisions;
    if (li.pbt != null && li.provisions != null) return li.pbt + li.provisions - (li.exceptional_items ?? 0);
    return null;
  }
  // EBITDA = Revenue from operations - operating expenses, where operating expenses exclude
  // finance cost and D&A. Computed in code, never by the model, so it is auditable.
  if (li.revenue_from_operations != null && li.total_expenses != null) {
    return li.revenue_from_operations - (li.total_expenses - (li.finance_costs ?? 0) - (li.depreciation ?? 0));
  }
  if (li.pbt != null && li.finance_costs != null && li.depreciation != null) {
    return li.pbt + li.finance_costs + li.depreciation - (li.other_income ?? 0) - (li.exceptional_items ?? 0);
  }
  return null;
}

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export function pct(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  if (b < 0 && a > 0) return null; // loss -> profit: % change is meaningless, UI says "turned profitable"
  return ((a - b) / Math.abs(b)) * 100;
}

function verdictLine(c: Omit<ResultsCard, "verdict" | "kind">): string {
  const f = (x: number | null) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);
  const revY = pct(c.revenue.cur, c.revenue.prevY);
  const patY = pct(c.pat.cur, c.pat.prevY);
  const mNow = c.revenue.cur && c.ebitda.cur != null ? (c.ebitda.cur / c.revenue.cur) * 100 : null;
  const mThen = c.revenue.prevY && c.ebitda.prevY != null ? (c.ebitda.prevY / c.revenue.prevY) * 100 : null;
  const parts = [`Revenue ${f(revY)} YoY`];
  if (mNow != null && mThen != null && !c.isLender) {
    const bps = Math.round((mNow - mThen) * 100);
    parts.push(`EBITDA margin ${mNow.toFixed(1)}% (${bps >= 0 ? "+" : ""}${bps} bps)`);
  }
  if (c.pat.cur != null && c.pat.prevY != null && c.pat.prevY < 0 && c.pat.cur > 0) parts.push("PAT turned positive");
  else parts.push(`PAT ${f(patY)} YoY`);
  return parts.join(" · ");
}

function quarterLabelFromPeriod(p: string): string | null {
  // "Quarter ended 30-Sep-2026" / "30.09.2026" / "September 30, 2026" -> "Sep 2026"
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m1 = p.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-.,]*(\d{1,2}[\s,]*)?(20\d\d)/i);
  if (m1) return `${m1[1][0].toUpperCase()}${m1[1].slice(1, 3).toLowerCase()} ${m1[3]}`;
  const m2 = p.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d\d)/);
  if (m2) return `${months[Number(m2[2]) - 1]} ${m2[3]}`;
  return null;
}

export function fiscalLabel(q: string): string {
  // "Sep 2026" -> "Q2 FY27 (Sep 2026)" (Indian FY starts in April)
  const [mon, yr] = q.split(" ");
  const qn = { Jun: 1, Sep: 2, Dec: 3, Mar: 4 }[mon as "Jun"];
  if (!qn) return q;
  const fy = mon === "Mar" ? Number(yr) : Number(yr) + 1;
  return `Q${qn} FY${String(fy).slice(2)} (${q})`;
}

export async function enrichResults(pdfUrl: string, sc?: ScreenerCompany | null): Promise<ResultsCard | null> {
  const bytes = await fetchPdf(pdfUrl);
  const res = await llm({
    tier: "bulk",
    parts: [{ text: RESULTS_PROMPT }, pdfPart(bytes)],
    json: true,
    cacheId: `results-v2|${pdfUrl}`,
    maxOutputTokens: 2048,
  });
  const x = parseJSON<ResultsExtract>(res.text);
  if (!x.found || !x.current) return null;
  const k = UNIT_TO_CRORE[x.unit] ?? 1;
  const lender = Boolean(x.is_lender || sc?.isLender);
  const scale = (v: number | null | undefined) => (v == null ? null : r1(v * k));
  const trip = (f: (li: LineItems) => number | null | undefined): Triplet => ({
    cur: scale(f(x.current)),
    prevQ: scale(f(x.previous_quarter || {})),
    prevY: scale(f(x.year_ago_quarter || {})),
  });
  const rev = (li: LineItems) => li.revenue_from_operations ?? li.total_income;
  const qLabel = quarterLabelFromPeriod(x.current_period || "") || "";
  const base = {
    period: qLabel ? fiscalLabel(qLabel) : x.current_period,
    basis: x.basis,
    isLender: lender,
    revenue: trip(rev),
    ebitda: trip((li) => ebitdaOf(li, lender)),
    pbt: trip((li) => li.pbt),
    pat: trip((li) => li.pat),
    ebitdaLabel: lender ? "Pre-provision profit" : "EBITDA",
    exceptional:
      x.current.exceptional_items && Math.abs(x.current.exceptional_items * k) > 0.05 * Math.abs((x.current.pbt ?? 0) * k)
        ? `Exceptional item of ₹${Math.abs(x.current.exceptional_items * k).toFixed(0)} cr ${x.current.exceptional_items < 0 ? "hit" : "lifted"} PBT`
        : null,
  };
  const card: ResultsCard = { kind: "results", ...base, verdict: verdictLine(base) };

  // Cross-check the model's reading against Screener's independently parsed table.
  if (sc && qLabel) {
    const i = sc.quarters.cols.indexOf(qLabel);
    if (i >= 0 && sc.basis === x.basis) {
      const sSales = row(sc.quarters, "Sales", "Revenue")[i];
      const sPat = row(sc.quarters, "Net Profit")[i];
      const near = (a: number | null, b: number | null, tol: number) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
      const ok = near(card.revenue.cur, sSales, 0.02) && near(card.pat.cur, sPat, 0.04);
      card.check = {
        source: "screener",
        agrees: ok,
        note: ok ? "Matches Screener's table" : `Screener shows revenue ${sSales ?? "–"} / PAT ${sPat ?? "–"} cr; check the filing`,
      };
    }
  }
  return card;
}

// ---------- management change ----------

interface MgmtExtract {
  people: { name: string; role: string; change: PersonBio["change"]; effective?: string | null; profile_in_filing?: string | null }[];
  reason?: string | null;
}

const MGMT_PROMPT = `This is an Indian stock-exchange filing about a change in directors or key management.
List every person whose position changes. For each: full name (no honorifics), role (e.g. "Chief Financial Officer"), change (appointed|resigned|retired|redesignated|other), effective date if stated, and profile_in_filing: a one-sentence summary of any background/profile given in the filing itself (null if none).
Also give "reason": the stated reason for a resignation, verbatim-short, else null.
Return JSON {"people":[...],"reason":...}.`;

export async function enrichManagement(f: Filing): Promise<MgmtCard | null> {
  const parts = [{ text: MGMT_PROMPT }, { text: `Subject: ${f.title}\nSummary: ${f.headline}` }] as Parameters<typeof llm>[0]["parts"];
  if (f.pdf) {
    try {
      parts.push(pdfPart(await fetchPdf(f.pdf)));
    } catch {
      /* headline-only extraction still works */
    }
  }
  const ex = parseJSON<MgmtExtract>(
    (await llm({ tier: "bulk", parts, json: true, cacheId: `mgmt-v1|${f.id}`, maxOutputTokens: 1024 })).text,
  );
  if (!ex.people?.length) return null;

  const people: PersonBio[] = [];
  for (const p of ex.people.slice(0, 3)) {
    const person: PersonBio = { name: p.name, role: p.role, change: p.change, effective: p.effective ?? null, bio: p.profile_in_filing ?? null };
    // Background search only for incoming people in senior roles: that is the question an investor asks.
    if (p.change === "appointed" || p.change === "redesignated") {
      try {
        const r = await llm({
          tier: "search",
          parts: [
            {
              text: `Search the web (LinkedIn, company websites, reputable business press) for the professional background of ${p.name}, newly ${p.change} as ${p.role} of ${f.company} (India).
Reply ONLY with JSON: {"bio": "<max 30 words: current expertise and the most relevant previous role>", "previously": ["<Role, Company>", "..."]} listing up to 3 prior roles, most recent first. If you cannot find this specific person, reply {"bio": null, "previously": []}.`,
            },
          ],
          cacheId: `bio-v1|${p.name}|${f.company}`,
          maxOutputTokens: 600,
        });
        const b = parseJSON<{ bio: string | null; previously: string[] }>(r.text);
        if (b.bio) person.bio = b.bio;
        person.previously = (b.previously || []).slice(0, 3);
        person.sources = (r.sources || []).slice(0, 3);
      } catch {
        /* keep the filing's own profile */
      }
    }
    people.push(person);
  }
  return { kind: "management", people, reason: ex.reason ?? null };
}

// ---------- everything else: one line, batched ----------

export interface Pending {
  id: string;
  company: string;
  title: string;
  headline: string;
  needsCategory: boolean;
}

const CATS: Category[] = Object.keys(BASE_SCORE) as Category[];

/** One cheap call for many filings: classify the ones rules missed and write a one-liner for each. */
export async function batchTriage(items: Pending[]): Promise<Record<string, { category?: Category; line: string; material?: boolean }>> {
  if (!items.length) return {};
  const out: Record<string, { category?: Category; line: string; material?: boolean }> = {};
  for (let i = 0; i < items.length; i += 20) {
    const chunk = items.slice(i, i + 20);
    const prompt = `You triage Indian stock-exchange filings for a busy portfolio manager.
For each filing below, return:
- "line": at most 18 words stating the concrete fact and, if material, why it matters. No filler, no "the company announced". Use numbers from the text when present.
- "category": one of ${CATS.join(", ")}${"  "}(only needed when needsCategory is true)
- "material": true only if it could plausibly move the stock.
Filings:
${chunk.map((c) => JSON.stringify({ id: c.id, company: c.company, subject: c.title, gist: c.headline.slice(0, 500), needsCategory: c.needsCategory })).join("\n")}
Return a JSON object keyed by id.`;
    try {
      const r = await llm({ tier: "bulk", parts: [{ text: prompt }], json: true, cacheId: `triage-v1|${chunk.map((c) => c.id).join(",")}` });
      Object.assign(out, parseJSON<typeof out>(r.text));
    } catch (e) {
      console.error("triage batch failed:", (e as Error).message);
    }
  }
  return out;
}

export function summaryCard(line: string): SummaryCard {
  return { kind: "summary", line };
}
