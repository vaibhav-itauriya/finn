// What the bot says back. Each reply is built from the same data the app shows, as a compact
// Telegram card with a button into the right screen.
import type { Digest } from "../types";
import type { Rules } from "../client/alerts";
import { moveAlerts } from "../client/alerts";
import { bundle } from "../client/bundle";
import { summarise } from "../client/portfolio";
import { dailyWrap, filingLine } from "../feed";
import { CATEGORY_LABEL } from "../push/classify";
import { snapshot, stepNumbers } from "../pull/research";
import { esc } from "./format";
import type { Button } from "./bot";

type Reply = { html: string; buttons?: Button[][] };

const pct = (x: number | null | undefined, d = 1) => (x == null ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`);
const lakh = (x: number) => `₹${(Math.abs(x) / 1e5).toFixed(2)} L`;

export function digestReply(d: Digest, hours: number, app: string): Reply {
  const gen = new Date(d.engine.generatedAt).getTime();
  const fs = d.filings.filter((f) => new Date(f.ts).getTime() >= gen - hours * 3600e3);
  const top = bundle(fs)
    .filter((x) => x.lead.tier === "material")
    .sort((a, z) => z.lead.score - a.lead.score)
    .slice(0, 8);
  const lines = top.map(({ lead: f }) => `• <b>${f.ticker}</b> ${CATEGORY_LABEL[f.category]}: ${esc(filingLine(f).slice(0, 160))}`);
  const label = hours <= 24 ? "24 hours" : `${Math.round(hours / 24)} days`;
  const head = top.length ? `<b>${top.length} thing${top.length === 1 ? "" : "s"} need you</b> · last ${label}` : `<b>Nothing material</b> in the last ${label}`;
  const folded = fs.length - top.length;
  return {
    html: `${head}\n${lines.join("\n")}${folded > 0 ? `\n<i>${folded} routine filings read and folded away.</i>` : ""}`,
    buttons: [[{ text: "Open the digest", url: `${app}/digest?w=${hours <= 24 ? "24h" : hours <= 72 ? "3d" : "7d"}` }]],
  };
}

export function wrapReply(d: Digest, app: string): Reply {
  const w = dailyWrap(d);
  return { html: `<b>${esc(w.title)}</b>\n${w.lines.map((l) => `• ${esc(l)}`).join("\n")}`, buttons: [[{ text: "Open the digest", url: `${app}/digest?w=24h` }]] };
}

export function portfolioReply(d: Digest, app: string): Reply {
  const s = summarise(d);
  const by = [...s.positions].filter((p) => p.day != null).sort((a, b) => (b.day ?? 0) - (a.day ?? 0));
  const fmt = (p: (typeof by)[number]) => `${p.h.ticker} ${pct(p.day)}`;
  return {
    html: [
      `<b>Portfolio</b> · ${d.portfolio.length} holdings · as of ${s.asOf}`,
      `Value <b>₹${(s.value / 1e5).toFixed(2)} L</b>`,
      `Last session ${s.dayPnl >= 0 ? "+" : "−"}${lakh(s.dayPnl)} (${pct(s.dayPct, 2)}) · 1 month ${pct(s.m1Pct)}`,
      `Breadth: ${s.up} up, ${s.down} down`,
      `Top: ${by.slice(0, 3).map(fmt).join(", ")}`,
      `Bottom: ${by.slice(-3).reverse().map(fmt).join(", ")}`,
    ].join("\n"),
    buttons: [[{ text: "Open portfolio", url: `${app}/portfolio` }]],
  };
}

export function movesReply(d: Digest, rules: Rules, app: string): Reply {
  const last = d.prices.map((p) => p.bars.at(-1)?.d).filter(Boolean).sort().at(-1) || "";
  const since = new Date(Date.parse(last) - 6 * 86400e3).toISOString().slice(0, 10);
  const ms = moveAlerts(d.prices, rules, since).slice(0, 10);
  const lines = ms.map((m) => `• <b>${m.ticker}</b> ${m.d.slice(5)}: ${pct(m.change)} on ${m.volX.toFixed(1)}× volume`);
  return {
    html: `<b>Unusual moves this week</b> at your lines (±${rules.moveAbs}%, ${rules.volMultiple}× volume)\n${lines.join("\n") || "None. Your holdings traded quietly."}`,
    buttons: [[{ text: "Change thresholds", url: `${app}/alerts` }]],
  };
}

export async function researchReply(ticker: string, app: string): Promise<Reply> {
  const t = ticker.toUpperCase().replace(/[^A-Z0-9&-]/g, "");
  const button = [[{ text: `Open ${t} research`, url: `${app}/research/${t}` }]];
  const snap = await snapshot(t);
  if (snap?.ledger) {
    const l = snap.ledger;
    const c = l.credibility;
    const rows = l.rows.slice(0, 4).map((r) => `• <b>${r.outcome}</b> ${esc(r.promise)}`);
    return {
      html: `<b>${t}</b> · kept ${c.delivered} of ${c.delivered + c.missed + c.partly + c.dropped + c.pending} promises · credibility ${c.score}/10\n<i>${esc(c.line)}</i>\n${rows.join("\n")}`,
      buttons: button,
    };
  }
  try {
    const { numbers: n } = await stepNumbers(t);
    const snapLines = n.snapshot.slice(0, 4).map((x) => `${x.label}: <b>${esc(x.value)}</b>${x.sub ? ` (${esc(x.sub)})` : ""}`);
    return {
      html: `<b>${esc(n.header.name)}</b> (${t})\n${snapLines.join("\n")}\n\nThe promise-vs-delivery check reads its last four earnings calls and latest annual report. That takes about a minute the first time, so open it in the app.`,
      buttons: button,
    };
  } catch {
    return { html: `Couldn't find <b>${esc(t)}</b>. Use the NSE symbol, like /research TITAN.` };
  }
}

export const HELP = (name: string) =>
  `<b>Hi ${esc(name)}, FINN is on.</b>
You'll get results, management changes and unusual moves for the demo portfolio here, at your thresholds, plus a short wrap after market close.

Ask anything in plain words or send a voice note. For example "What needs me today?" or "Did Titan deliver on its guidance?"

/digest what needs you · /portfolio · /moves · /research TITAN · /wrap · /settings · /stop`;
