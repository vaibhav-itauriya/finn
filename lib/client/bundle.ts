// Collapse filings that are really one event: a results day produces the results PDF, the board
// outcome, a press release, an investor deck and a newspaper ad; an insolvency case produces a
// stream of near-identical "updates". The investor wants one item with the related papers inside.
import type { Filing } from "../types";

export interface Bundle {
  lead: Filing;
  related: Filing[];
  key: string;
}

const istDay = (ts: string) => new Date(new Date(ts).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

function normTitle(t: string) {
  return t
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function keyOf(f: Filing) {
  if (f.category === "results" || f.category === "earnings_call") return `${f.ticker}|results|${istDay(f.ts)}`;
  return `${f.ticker}|${f.category}|${normTitle(f.title)}`;
}

function leadRank(f: Filing) {
  const e = f.enrichment;
  return (e?.kind === "results" ? 1000 : e?.kind === "management" ? 500 : e ? 100 : 0) + f.score;
}

export function bundle(filings: Filing[]): Bundle[] {
  const groups = new Map<string, Filing[]>();
  for (const f of filings) {
    const k = keyOf(f);
    const g = groups.get(k);
    if (g) g.push(f);
    else groups.set(k, [f]);
  }
  return [...groups.entries()].map(([key, fs]) => {
    const sorted = [...fs].sort((a, b) => leadRank(b) - leadRank(a));
    const lead = { ...sorted[0], score: Math.max(...fs.map((x) => x.score)) };
    // A bundle is as fresh as its newest member.
    lead.ts = fs.map((x) => x.ts).sort().at(-1)!;
    return { key, lead, related: sorted.slice(1).sort((a, b) => b.ts.localeCompare(a.ts)) };
  });
}
