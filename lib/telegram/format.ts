// Telegram messages as structured cards, not paragraphs. Results get an aligned 4-row table
// (Revenue, EBITDA, PBT, PAT with QoQ and YoY) in a monospace block so it reads like the app.
import type { Category, Filing, Triplet } from "../types";
import type { MoveAlert } from "../client/alerts";
import { CATEGORY_LABEL } from "../push/classify";
import type { FeedItem } from "../feed";

export const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

const pct = (a: number | null, b: number | null) => {
  if (a == null || b == null || b === 0) return "   –  ";
  if (b < 0) return a > 0 ? "  turn" : "   –  ";
  const v = ((a - b) / Math.abs(b)) * 100;
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`.padStart(6);
};
const cr = (x: number | null) => (x == null ? "–" : Math.round(x).toLocaleString("en-IN"));

function table(rows: [string, Triplet][]) {
  const head = `${"₹ cr".padEnd(8)}${"Qtr".padStart(9)}${"QoQ".padStart(8)}${"YoY".padStart(8)}`;
  const body = rows.map(([l, t]) => `${l.padEnd(8)}${cr(t.cur).padStart(9)}${pct(t.cur, t.prevQ).padStart(8)}${pct(t.cur, t.prevY).padStart(8)}`);
  return `<pre>${esc([head, ...body].join("\n"))}</pre>`;
}

export function filingMessage(f: Filing, appUrl: string): string {
  const e = f.enrichment;
  const head = `<b>${f.ticker}</b> · ${CATEGORY_LABEL[f.category]}`;
  const links = [`<a href="${appUrl}/research/${f.ticker}">Research ${f.ticker}</a>`, f.pdf ? `<a href="${f.pdf}">Filing</a>` : ""].filter(Boolean).join(" · ");
  if (e?.kind === "results") {
    return `${head} · ${esc(e.period.split(" (")[0])}\n${esc(e.verdict)}\n${table([
      ["Revenue", e.revenue],
      [e.isLender ? "PPOP" : "EBITDA", e.ebitda],
      ["PBT", e.pbt],
      ["PAT", e.pat],
    ])}${e.check?.agrees ? "✓ matches Screener\n" : ""}${links}`;
  }
  if (e?.kind === "management") {
    const people = e.people
      .slice(0, 2)
      .map((p) => `• <b>${esc(p.name)}</b>, ${esc(p.role)} (${p.change})${p.bio ? `\n  <i>${esc(p.bio)}</i>` : ""}${p.previously?.length ? `\n  Previously: ${esc(p.previously.join("; "))}` : ""}`)
      .join("\n");
    return `${head}\n${people}\n${links}`;
  }
  const body = e?.kind === "summary" ? e.line : f.title;
  return `${head}\n${esc(body)}\n${links}`;
}

export function moveMessage(m: MoveAlert, appUrl: string): string {
  const bits: string[] = [];
  if (m.kinds.includes("price")) bits.push(`${m.change > 0 ? "+" : "−"}${Math.abs(m.change).toFixed(1)}% on the day`);
  if (m.kinds.includes("volume")) bits.push(`volume ${m.volX.toFixed(1)}× its 20-day average`);
  return `<b>${m.ticker}</b> · Unusual move · ${m.d}\nClosed ₹${m.close.toLocaleString("en-IN")}, ${bits.join(", ")}\n<a href="${appUrl}/research/${m.ticker}">Research ${m.ticker}</a>`;
}

export function digestMessage(title: string, lines: string[], appUrl: string): string {
  return `<b>${esc(title)}</b>\n${lines.map((l) => `• ${l}`).join("\n")}\n<a href="${appUrl}/digest?w=24h">Open the digest</a>`;
}

/** What the pipeline hands to /api/telegram/broadcast: a feed item plus its Telegram rendering. */
export type PushItem = FeedItem & { html: string };
