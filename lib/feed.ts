// One definition of "this deserves to interrupt you", shared by every channel: the in-app inbox,
// Telegram, phone notifications and the voice copilot. The pipeline produces candidates with loose
// thresholds; each person's own rules decide what actually reaches them.
import type { Digest, Filing } from "./types";
import { DEFAULT_RULES, moveAlerts, type MoveAlert, type Rules } from "./client/alerts";
import { bundle } from "./client/bundle";
import { CATEGORY_LABEL } from "./push/classify";

export interface FeedItem {
  id: string;
  kind: "filing" | "move" | "digest";
  ticker: string;
  category?: Filing["category"];
  tier?: string;
  score?: number;
  change?: number;
  volX?: number;
  ts: string;
  title: string; // short, for a lock-screen notification
  body: string; // one or two lines
  path: string; // where tapping it goes in the app
  ref?: string; // the lead filing's id, for channels that render the full card
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** The one line that makes a filing worth reading, in plain text. */
export function filingLine(f: Filing): string {
  const e = f.enrichment;
  if (e?.kind === "results") return `${e.period.split(" (")[0]}: ${e.verdict}`;
  if (e?.kind === "management") {
    const p = e.people[0];
    const who = `${p.name} ${p.change} as ${p.role}`;
    if (p.previously?.length) return `${who}. Previously ${p.previously[0]}.`;
    // Bios often open by repeating the name: drop it so the line reads on.
    const bio = p.bio?.replace(new RegExp(`^(Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Shri)?\\s*${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},?\\s*`, "i"), "");
    return bio ? `${who}. ${clip(bio.charAt(0).toUpperCase() + bio.slice(1), 140)}` : `${who}.`;
  }
  if (e?.kind === "summary") return e.line;
  return f.title;
}

export function filingItem(f: Filing): FeedItem {
  return {
    id: `f:${f.id}`,
    kind: "filing",
    ticker: f.ticker,
    category: f.category,
    tier: f.tier,
    score: f.score,
    ts: f.ts,
    title: `${f.ticker} · ${CATEGORY_LABEL[f.category]}`,
    body: clip(filingLine(f), 180),
    path: `/digest?f=${encodeURIComponent(f.id)}`,
    ref: f.id,
  };
}

export function moveItem(m: MoveAlert): FeedItem {
  const bits: string[] = [];
  bits.push(`${m.change > 0 ? "+" : "−"}${Math.abs(m.change).toFixed(1)}% on the day`);
  if (m.volX >= 1.5) bits.push(`volume ${m.volX.toFixed(1)}× its 20-day average`);
  return {
    id: `m:${m.ticker}:${m.d}`,
    kind: "move",
    ticker: m.ticker,
    change: m.change,
    volX: m.volX,
    ts: `${m.d}T15:30:00+05:30`,
    title: `${m.ticker} · Unusual move`,
    body: `Closed ₹${m.close.toLocaleString("en-IN")}, ${bits.join(", ")}`,
    path: `/portfolio?h=${m.ticker}`,
  };
}

/** Everything that could interrupt someone over the last `days`, newest first. */
export function candidates(d: Digest, days = 7): FeedItem[] {
  const gen = new Date(d.engine.generatedAt).getTime();
  const since = gen - days * 86400e3;
  const out: FeedItem[] = [];
  for (const b of bundle(d.filings.filter((f) => new Date(f.ts).getTime() >= since))) {
    if (b.lead.tier === "routine") continue;
    const it = filingItem(b.lead);
    // A bundle keeps one id however many papers the company files for the same event.
    it.id = `f:${[b.lead.id, ...b.related.map((r) => r.id)].sort()[0]}`;
    out.push(it);
  }
  const day = new Date(since + 5.5 * 3600e3).toISOString().slice(0, 10);
  for (const m of moveAlerts(d.prices, { ...DEFAULT_RULES, moveAbs: 2, volMultiple: 1.5 }, day)) out.push(moveItem(m));
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}

/** Would this person want to be interrupted by this item? */
export function wants(it: FeedItem, rules: Rules): boolean {
  if (it.kind === "digest") return rules.dailyDigest !== false;
  if (it.kind === "move") return Math.abs(it.change ?? 0) >= rules.moveAbs || (it.volX ?? 0) >= rules.volMultiple;
  if (rules.muted.includes(`${it.ticker}:${it.category}`)) return false;
  return it.tier === "material" || Boolean(it.category && rules.pushCategories.includes(it.category) && (it.score ?? 0) >= 45);
}

/** The evening wrap: what mattered across the portfolio in the last 24 hours, as plain lines. */
export function dailyWrap(d: Digest): { title: string; lines: string[] } {
  const gen = new Date(d.engine.generatedAt).getTime();
  const fs = d.filings.filter((f) => new Date(f.ts).getTime() >= gen - 24 * 3600e3);
  const top = bundle(fs)
    .filter((b) => b.lead.tier === "material")
    .sort((a, z) => z.lead.score - a.lead.score)
    .slice(0, 6)
    .map(({ lead }) => `${lead.ticker} ${CATEGORY_LABEL[lead.category]}: ${clip(filingLine(lead), 140)}`);
  const day = new Date(gen - 2 * 86400e3 + 5.5 * 3600e3).toISOString().slice(0, 10);
  const last = d.prices.map((p) => p.bars.at(-1)?.d).filter(Boolean).sort().at(-1) || day;
  const moves = moveAlerts(d.prices, DEFAULT_RULES, last).slice(0, 4).map((m) => `${m.ticker} moved ${m.change > 0 ? "+" : "−"}${Math.abs(m.change).toFixed(1)}%${m.volX >= 2 ? ` on ${m.volX.toFixed(1)}× volume` : ""}`);
  const lines = [...top, ...moves];
  return {
    title: lines.length ? `FINN evening wrap · ${top.length} filing${top.length === 1 ? "" : "s"} and ${moves.length} move${moves.length === 1 ? "" : "s"} worth your time` : "FINN evening wrap · a quiet day",
    lines: lines.length ? lines : [`${fs.length} filings read, all routine. Nothing needs you.`],
  };
}
